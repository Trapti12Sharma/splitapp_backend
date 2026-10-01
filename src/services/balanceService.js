const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { simplifyDebts } = require('../utils/debtSimplification');
const TTLCache = require('../utils/ttlCache');

/**
 * Balance maps are read on almost every screen (dashboard, friends list, friend
 * detail, analytics summary) and are relatively expensive to build. Cache them
 * for a short window and invalidate explicitly whenever an expense or settlement
 * changes, so a user never sees their own write go missing.
 */
const balanceCache = new TTLCache({ ttlMs: 20000, maxSize: 5000 });
setInterval(() => balanceCache.prune(), 60000).unref();

/** Drop every cached balance that could be affected by a change involving these users. */
const invalidateBalances = (...userIds) => {
  for (const id of userIds.flat()) {
    if (!id) continue;
    balanceCache.deletePrefix(`user:${id.toString()}`);
  }
};

const invalidateGroupBalances = (groupId) => {
  if (!groupId) return;
  balanceCache.deletePrefix(`group:${groupId.toString()}`);
};

// Only the fields the balance maths actually reads. Skipping description/notes/
// receipt keeps a large result set an order of magnitude smaller over the wire.
const EXPENSE_BALANCE_FIELDS = { paidBy: 1, amount: 1, 'splits.user': 1, 'splits.amount': 1 };
const SETTLEMENT_BALANCE_FIELDS = { from: 1, to: 1, amount: 1 };

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Build the raw balance map for a user from already-fetched expenses/settlements.
 * Kept separate so callers that already hold the documents don't re-query.
 */
const reduceToBalanceMap = (userIdStr, expenses, settlements) => {
  const balanceMap = {};

  const add = (id, delta) => {
    const key = id.toString();
    balanceMap[key] = (balanceMap[key] || 0) + delta;
  };

  // Process expenses
  for (const expense of expenses) {
    const paidByStr = expense.paidBy.toString();
    const userIsPayer = paidByStr === userIdStr;

    for (const split of expense.splits) {
      const splitUserStr = split.user.toString();

      // Skip if both payer and split user are the same person
      if (paidByStr === splitUserStr) continue;

      if (userIsPayer) {
        // I paid — splitUser owes me their share
        add(splitUserStr, split.amount);
      } else if (splitUserStr === userIdStr) {
        // I owe the payer my share
        add(paidByStr, -split.amount);
      }
    }
  }

  // Process settlements
  for (const settlement of settlements) {
    const fromStr = settlement.from.toString();
    const toStr = settlement.to.toString();

    if (fromStr === userIdStr) {
      // I paid them, so my debt to them shrinks (their entry moves up).
      add(toStr, settlement.amount);
    } else if (toStr === userIdStr) {
      // They paid me, so what they owe me shrinks.
      add(fromStr, -settlement.amount);
    }
  }

  delete balanceMap[userIdStr];

  for (const key of Object.keys(balanceMap)) {
    balanceMap[key] = round2(balanceMap[key]);
    if (Math.abs(balanceMap[key]) < 0.01) {
      delete balanceMap[key];
    }
  }

  return balanceMap;
};

/**
 * Calculate net balances for a user with every other user they share expenses with.
 * Returns: { userId: netAmount } — positive means userId owes current user money.
 */
const calculateUserBalances = async (userId) => {
  const userIdStr = userId.toString();
  const cacheKey = `user:${userIdStr}:all`;

  const cached = balanceCache.get(cacheKey);
  if (cached) return { ...cached };

  // Both queries are independent — run them concurrently, and fetch only the
  // fields the maths needs rather than whole documents.
  const [expenses, settlements] = await Promise.all([
    Expense.find({ $or: [{ paidBy: userId }, { 'splits.user': userId }] })
      .select(EXPENSE_BALANCE_FIELDS)
      .lean(),
    Settlement.find({ $or: [{ from: userId }, { to: userId }] })
      .select(SETTLEMENT_BALANCE_FIELDS)
      .lean(),
  ]);

  const balanceMap = reduceToBalanceMap(userIdStr, expenses, settlements);
  balanceCache.set(cacheKey, balanceMap);

  return { ...balanceMap };
};

/**
 * Summarise a balance map into totals. Accepts a pre-computed map so callers that
 * already have one (e.g. GET /api/balances) don't pay for the work twice.
 */
const summariseBalanceMap = (balanceMap) => {
  let totalOwedToUser = 0; // positive balances (others owe me)
  let totalOwed = 0;       // negative balances (I owe others)

  for (const amount of Object.values(balanceMap)) {
    if (amount > 0) totalOwedToUser += amount;
    else totalOwed += Math.abs(amount);
  }

  return {
    totalOwedToUser: round2(totalOwedToUser),
    totalOwed: round2(totalOwed),
    netBalance: round2(totalOwedToUser - totalOwed),
  };
};

/**
 * Get overall summary for a user: totalOwed, totalOwedToUser, netBalance
 */
const getUserBalanceSummary = async (userId, precomputedMap = null) => {
  const balanceMap = precomputedMap || (await calculateUserBalances(userId));
  return summariseBalanceMap(balanceMap);
};

/**
 * Calculate balances for all members within a group.
 * Returns array of { userId, netAmount } and who-owes-whom list.
 */
const calculateGroupBalances = async (groupId, memberIds) => {
  const memberIdStrings = memberIds.map((id) => id.toString());
  // Sort IDs so the cache key is stable regardless of member fetch order.
  const sortedIds = [...memberIdStrings].sort();
  const cacheKey = `group:${groupId.toString()}:${sortedIds.join(',')}`;

  const cached = balanceCache.get(cacheKey);
  if (cached) {
    return { memberBalances: { ...cached.memberBalances }, whoOwesWhom: cached.whoOwesWhom };
  }

  const [expenses, settlements] = await Promise.all([
    Expense.find({ group: groupId }).select(EXPENSE_BALANCE_FIELDS).lean(),
    Settlement.find({ group: groupId }).select(SETTLEMENT_BALANCE_FIELDS).lean(),
  ]);

  // Net balance per member within group.
  // Positive = this member is owed money (paid more than their share).
  // Negative = this member owes money (their share exceeds what they paid).
  const netMap = {};
  memberIdStrings.forEach((id) => { netMap[id] = 0; });

  for (const expense of expenses) {
    const paidByStr = expense.paidBy.toString();

    // Payer gets credit for the full amount
    if (netMap[paidByStr] !== undefined) {
      netMap[paidByStr] += expense.amount;
    }

    // Each participant (including payer) is debited their share
    for (const split of expense.splits) {
      const splitUserStr = split.user.toString();
      if (netMap[splitUserStr] !== undefined) {
        netMap[splitUserStr] -= split.amount;
      }
    }
  }

  // Apply group-scoped settlements.
  // `from` is the payer: their balance improves (they discharged cash).
  // `to` is the receiver: their "credit" shrinks (they received cash back).
  for (const settlement of settlements) {
    const fromStr = settlement.from.toString();
    const toStr = settlement.to.toString();
    if (netMap[fromStr] !== undefined) netMap[fromStr] += settlement.amount;
    if (netMap[toStr] !== undefined) netMap[toStr] -= settlement.amount;
  }

  // Round to 2 dp
  for (const key of Object.keys(netMap)) {
    netMap[key] = round2(netMap[key]);
  }

  // Pass the net map directly to simplifyDebts. The previous code built
  // a cartesian product of debtor×creditor pairs and fed that into
  // simplifyDebts, which then recomputed net balances from those pairs — the
  // double-computation produced wrong amounts and wrong creditor assignments.
  // simplifyDebts now accepts a pre-computed net map directly.
  const simplified = simplifyDebts(netMap);

  const result = { memberBalances: netMap, whoOwesWhom: simplified };
  balanceCache.set(cacheKey, result);

  return { memberBalances: { ...netMap }, whoOwesWhom: simplified };
};

/**
 * Get balance between two specific users (across all shared expenses, not group-specific).
 *
 * This used to build the user's *entire* balance map just to read one entry. Now it
 * queries only the documents that involve both people, which is a far smaller set.
 */
const getFriendBalance = async (userId, friendId) => {
  const userIdStr = userId.toString();
  const friendIdStr = friendId.toString();
  const cacheKey = `user:${userIdStr}:friend:${friendIdStr}`;

  const cached = balanceCache.get(cacheKey);
  if (cached) return { ...cached };

  // An expense only moves the balance between these two if one of them paid and
  // the *other* has a split in it. (Note this must not require the payer to also
  // have a split — paying someone's whole share still creates a debt.)
  const [expenses, settlements] = await Promise.all([
    Expense.find({
      $or: [
        { paidBy: userId, 'splits.user': friendId },
        { paidBy: friendId, 'splits.user': userId },
      ],
    })
      .select(EXPENSE_BALANCE_FIELDS)
      .lean(),
    Settlement.find({
      $or: [
        { from: userId, to: friendId },
        { from: friendId, to: userId },
      ],
    })
      .select(SETTLEMENT_BALANCE_FIELDS)
      .lean(),
  ]);

  const balanceMap = reduceToBalanceMap(userIdStr, expenses, settlements);
  const net = balanceMap[friendIdStr] || 0;

  const result = {
    netBalance: net,
    // positive: friend owes me, negative: I owe friend
    youOwe: net < 0 ? Math.abs(net) : 0,
    theyOwe: net > 0 ? net : 0,
  };

  balanceCache.set(cacheKey, result);
  return { ...result };
};

module.exports = {
  calculateUserBalances,
  getUserBalanceSummary,
  summariseBalanceMap,
  calculateGroupBalances,
  getFriendBalance,
  invalidateBalances,
  invalidateGroupBalances,
  balanceCache,
};
