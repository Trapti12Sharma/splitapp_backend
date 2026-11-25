const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const User = require('../models/User');
const { computeGroupNetMap } = require('./balanceService');
const { simplifyDebts } = require('../utils/debtSimplification');

/**
 * Builds the complete, export-ready picture of one group: every expense with its
 * per-person split, every settlement, per-person totals, category breakdown and
 * the simplified "who owes whom" plan.
 *
 * The maths is deliberately the same as the Balances tab (`computeGroupNetMap`
 * + `simplifyDebts`), so the downloaded sheet always agrees with the app.
 */

const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => c / 100;
const idStr = (ref) => (ref && ref._id ? ref._id : ref)?.toString() ?? null;

const ROLE_ORDER = { admin: 0, member: 1, former: 2 };

/**
 * Pure: turns already-fetched documents into the report model.
 *
 * @param {object}   args
 * @param {object}   args.group        lean Group (members.user may be populated or raw ids)
 * @param {object[]} args.expenses     lean Expenses (unpopulated refs)
 * @param {object[]} args.settlements  lean Settlements (unpopulated refs)
 * @param {object[]} args.users        lean Users referenced anywhere in the group
 * @param {object}   args.generatedBy  the requesting user ({ name })
 * @param {Date}     [args.generatedAt]
 */
const buildGroupReport = ({ group, expenses, settlements, users, generatedBy, generatedAt = new Date() }) => {
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  // ── People ──────────────────────────────────────────────────────────────
  // Current members first (in group order), then anyone who still appears in
  // the group's history but has since left — the split matrix needs a column
  // for every participant so each expense row adds up to its amount.
  const people = [];
  const personIndex = new Map();
  const addPerson = (id, role, joinedAt = null) => {
    if (!id || personIndex.has(id)) return;
    const u = userMap.get(id);
    personIndex.set(id, people.length);
    people.push({
      id,
      name: u?.name || 'Deleted user',
      username: u?.username || '',
      role,
      joinedAt,
      paidCents: 0,
      shareCents: 0,
      settlementsPaidCents: 0,
      settlementsReceivedCents: 0,
      expensesPaidCount: 0,
      expensesInvolvedCount: 0,
    });
  };

  const memberIds = [];
  for (const m of group.members || []) {
    const id = idStr(m.user);
    // getGroupById drops members whose user document was deleted; do the same.
    if (!id || !userMap.has(id)) continue;
    memberIds.push(id);
    addPerson(id, m.role === 'admin' ? 'admin' : 'member', m.joinedAt || null);
  }
  for (const e of expenses) {
    addPerson(idStr(e.paidBy), 'former');
    for (const s of e.splits || []) addPerson(idStr(s.user), 'former');
  }
  for (const s of settlements) {
    addPerson(idStr(s.from), 'former');
    addPerson(idStr(s.to), 'former');
  }
  people.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  people.forEach((p, i) => personIndex.set(p.id, i));
  const person = (id) => people[personIndex.get(id)];

  // ── Expenses ────────────────────────────────────────────────────────────
  // Ledger order: oldest first, ties broken by creation time.
  const sortedExpenses = [...expenses].sort(
    (a, b) => new Date(a.date) - new Date(b.date) || new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  );

  const categoryMap = new Map();
  let totalCents = 0;

  const expenseRows = sortedExpenses.map((e) => {
    const amountCents = toCents(e.amount);
    const paidById = idStr(e.paidBy);
    totalCents += amountCents;

    const payer = person(paidById);
    payer.paidCents += amountCents;
    payer.expensesPaidCount += 1;

    const category = e.category || 'Other';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, { category, count: 0, totalCents: 0, byPersonCents: {} });
    }
    const cat = categoryMap.get(category);
    cat.count += 1;
    cat.totalCents += amountCents;

    const involved = new Set([paidById]);
    const splits = (e.splits || []).map((s) => {
      const uid = idStr(s.user);
      const shareCents = toCents(s.amount);
      const p = person(uid);
      p.shareCents += shareCents;
      cat.byPersonCents[uid] = (cat.byPersonCents[uid] || 0) + shareCents;
      involved.add(uid);
      return {
        userId: uid,
        amount: fromCents(shareCents),
        percentage: s.percentage ?? null,
        shares: s.shares ?? null,
      };
    });
    for (const uid of involved) person(uid).expensesInvolvedCount += 1;

    return {
      id: e._id?.toString(),
      date: e.date ? new Date(e.date) : null,
      description: e.description || '',
      category,
      amount: fromCents(amountCents),
      currency: e.currency || 'INR',
      paidById,
      splitType: e.splitType,
      splits,
      notes: e.notes || '',
      createdByName: userMap.get(idStr(e.createdBy))?.name || '',
    };
  });

  // ── Settlements ─────────────────────────────────────────────────────────
  const settlementRows = [...settlements]
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .map((s) => {
      const fromId = idStr(s.from);
      const toId = idStr(s.to);
      const cents = toCents(s.amount);
      person(fromId).settlementsPaidCents += cents;
      person(toId).settlementsReceivedCents += cents;
      return {
        date: s.createdAt ? new Date(s.createdAt) : null,
        fromId,
        toId,
        amount: fromCents(cents),
        currency: s.currency || 'INR',
        note: s.note || '',
      };
    });

  // ── Balances (single source of truth shared with the Balances tab) ──────
  const netMap = computeGroupNetMap(expenses, settlements, memberIds);
  const settlePlan = simplifyDebts(netMap).map((t) => ({
    fromId: t.from.toString(),
    toId: t.to.toString(),
    amount: t.amount,
  }));

  const peopleOut = people.map((p) => ({
    id: p.id,
    name: p.name,
    username: p.username,
    role: p.role,
    joinedAt: p.joinedAt ? new Date(p.joinedAt) : null,
    paid: fromCents(p.paidCents),
    share: fromCents(p.shareCents),
    settlementsPaid: fromCents(p.settlementsPaidCents),
    settlementsReceived: fromCents(p.settlementsReceivedCents),
    net: netMap[p.id] ?? 0,
    expensesPaidCount: p.expensesPaidCount,
    expensesInvolvedCount: p.expensesInvolvedCount,
  }));

  const categories = [...categoryMap.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((c) => ({
      category: c.category,
      count: c.count,
      total: fromCents(c.totalCents),
      percentage: totalCents ? c.totalCents / totalCents : 0,
      byPerson: Object.fromEntries(Object.entries(c.byPersonCents).map(([k, v]) => [k, fromCents(v)])),
    }));

  // ── Currency ────────────────────────────────────────────────────────────
  // Totals across the app are summed as plain numbers. When a group mixes
  // currencies we say so instead of stamping one symbol on everything.
  const codes = [...new Set([...expenseRows, ...settlementRows].map((r) => r.currency))];
  const code = codes.length === 1 ? codes[0] : codes.length === 0 ? 'INR' : null;

  // reduce, not Math.min(...dates): spreading a large array can overflow the stack.
  let firstTime = null;
  let lastTime = null;
  for (const e of expenseRows) {
    const t = e.date?.getTime();
    if (t == null || Number.isNaN(t)) continue;
    if (firstTime === null || t < firstTime) firstTime = t;
    if (lastTime === null || t > lastTime) lastTime = t;
  }

  return {
    group: {
      id: group._id?.toString(),
      name: group.name,
      description: group.description || '',
      createdAt: group.createdAt ? new Date(group.createdAt) : null,
      createdByName: userMap.get(idStr(group.createdBy))?.name || '',
      memberCount: memberIds.length,
    },
    generatedAt,
    generatedByName: generatedBy?.name || '',
    currency: {
      code,
      symbol: code ? CURRENCY_SYMBOLS[code] || code : '',
      mixed: codes.length > 1,
      codes,
    },
    people: peopleOut,
    expenses: expenseRows,
    settlements: settlementRows,
    categories,
    settlePlan,
    totals: {
      amount: fromCents(totalCents),
      expenseCount: expenseRows.length,
      settlementCount: settlementRows.length,
      settlementAmount: fromCents(settlementRows.reduce((sum, s) => sum + toCents(s.amount), 0)),
      firstDate: firstTime === null ? null : new Date(firstTime),
      lastDate: lastTime === null ? null : new Date(lastTime),
    },
  };
};

/**
 * Fetches everything for an already-loaded group and builds the report.
 * Caller is responsible for the membership check.
 *
 * @param {object} group          plain Group object (unpopulated members)
 * @param {object} requestingUser req.user
 */
const loadGroupReport = async (group, requestingUser) => {
  const groupId = group._id;
  const [expenses, settlements] = await Promise.all([
    Expense.find({ group: groupId })
      .select('description amount currency category paidBy splitType splits notes date createdBy createdAt')
      .lean(),
    Settlement.find({ group: groupId }).select('from to amount currency note createdAt').lean(),
  ]);

  // One lookup for every person referenced anywhere, instead of populate():
  // populate turns a deleted user into null and loses their id, which would
  // make the sheet's balances drift from the Balances tab.
  const ids = new Set([idStr(group.createdBy)]);
  for (const m of group.members || []) ids.add(idStr(m.user));
  for (const e of expenses) {
    ids.add(idStr(e.paidBy));
    ids.add(idStr(e.createdBy));
    for (const s of e.splits || []) ids.add(idStr(s.user));
  }
  for (const s of settlements) {
    ids.add(idStr(s.from));
    ids.add(idStr(s.to));
  }
  ids.delete(null);

  const users = await User.find({ _id: { $in: [...ids] } }).select('name username').lean();

  return buildGroupReport({ group, expenses, settlements, users, generatedBy: requestingUser });
};

module.exports = { buildGroupReport, loadGroupReport, CURRENCY_SYMBOLS };
