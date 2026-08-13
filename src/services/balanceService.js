const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { simplifyDebts } = require('../utils/debtSimplification');

/**
 * Calculate net balances for a user with every other user they share expenses with.
 * Returns: { userId: netAmount } — positive means userId owes current user money.
 */
const calculateUserBalances = async (userId) => {
  const userIdStr = userId.toString();

  // Get all expenses involving this user (as payer or split participant)
  const expenses = await Expense.find({
    $or: [{ paidBy: userId }, { 'splits.user': userId }],
  }).lean();

  // Get all settlements involving this user
  const settlements = await Settlement.find({
    $or: [{ from: userId }, { to: userId }],
  }).lean();

  // Map: otherUserId -> net balance (positive = they owe me, negative = I owe them)
  const balanceMap = {};

  const ensureKey = (id) => {
    const key = id.toString();
    if (!balanceMap[key]) balanceMap[key] = 0;
    return key;
  };

  // Process expenses
  for (const expense of expenses) {
    const paidByStr = expense.paidBy.toString();

    for (const split of expense.splits) {
      const splitUserStr = split.user.toString();

      // Skip if both payer and split user are the same person
      if (paidByStr === splitUserStr) continue;

      if (paidByStr === userIdStr) {
        // I paid — splitUser owes me their share
        const key = ensureKey(splitUserStr);
        balanceMap[key] += split.amount;
      } else if (splitUserStr === userIdStr) {
        // I owe the payer my share
        const key = ensureKey(paidByStr);
        balanceMap[key] -= split.amount;
      }
    }
  }

  // Process settlements
  for (const settlement of settlements) {
    const fromStr = settlement.from.toString();
    const toStr = settlement.to.toString();

    if (fromStr === userIdStr) {
      // I paid someone (fromStr=me) to reduce what I owe them
      // So their balance toward me decreases (they owe me less, or I owe them less)
      const key = ensureKey(toStr);
      balanceMap[key] -= settlement.amount; // reduces their debt to me (or increases my debt to them)
    } else if (toStr === userIdStr) {
      // Someone paid me — reduces what they owe me
      const key = ensureKey(fromStr);
      balanceMap[key] -= settlement.amount;
    }
  }

  // Remove self entry if it exists
  delete balanceMap[userIdStr];

  // Round all values
  for (const key of Object.keys(balanceMap)) {
    balanceMap[key] = Math.round(balanceMap[key] * 100) / 100;
    if (Math.abs(balanceMap[key]) < 0.01) {
      delete balanceMap[key];
    }
  }

  return balanceMap;
};

/**
 * Get overall summary for a user: totalOwed, totalOwedToUser, netBalance
 */
const getUserBalanceSummary = async (userId) => {
  const balanceMap = await calculateUserBalances(userId);

  let totalOwedToUser = 0; // positive balances (others owe me)
  let totalOwed = 0;       // negative balances (I owe others)

  for (const amount of Object.values(balanceMap)) {
    if (amount > 0) totalOwedToUser += amount;
    else totalOwed += Math.abs(amount);
  }

  return {
    totalOwedToUser: Math.round(totalOwedToUser * 100) / 100,
    totalOwed: Math.round(totalOwed * 100) / 100,
    netBalance: Math.round((totalOwedToUser - totalOwed) * 100) / 100,
  };
};

/**
 * Calculate balances for all members within a group.
 * Returns array of { userId, netAmount } and who-owes-whom list.
 */
const calculateGroupBalances = async (groupId, memberIds) => {
  const memberIdStrings = memberIds.map((id) => id.toString());

  // Get all expenses for this group
  const expenses = await Expense.find({ group: groupId }).lean();

  // Get all settlements for this group
  const settlements = await Settlement.find({ group: groupId }).lean();

  // Net balance per member within group
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

  // Apply settlements
  for (const settlement of settlements) {
    const fromStr = settlement.from.toString();
    const toStr = settlement.to.toString();
    if (netMap[fromStr] !== undefined) netMap[fromStr] += settlement.amount;
    if (netMap[toStr] !== undefined) netMap[toStr] -= settlement.amount;
  }

  // Round
  for (const key of Object.keys(netMap)) {
    netMap[key] = Math.round(netMap[key] * 100) / 100;
  }

  // Build raw transactions for simplification
  const rawTransactions = [];
  const memberBalances = Object.entries(netMap);

  // Build who-owes-whom from net positions
  const creditors = memberBalances.filter(([, v]) => v > 0.01).map(([id, v]) => ({ id, amount: v }));
  const debtors = memberBalances.filter(([, v]) => v < -0.01).map(([id, v]) => ({ id, amount: Math.abs(v) }));

  for (const debtor of debtors) {
    for (const creditor of creditors) {
      rawTransactions.push({ from: debtor.id, to: creditor.id, amount: Math.min(debtor.amount, creditor.amount) });
    }
  }

  const simplified = simplifyDebts(rawTransactions);

  return {
    memberBalances: netMap,
    whoOwesWhom: simplified,
  };
};

/**
 * Get balance between two specific users (across all shared expenses, not group-specific)
 */
const getFriendBalance = async (userId, friendId) => {
  const balanceMap = await calculateUserBalances(userId);
  const friendIdStr = friendId.toString();
  const net = balanceMap[friendIdStr] || 0;

  return {
    netBalance: net,
    // positive: friend owes me, negative: I owe friend
    youOwe: net < 0 ? Math.abs(net) : 0,
    theyOwe: net > 0 ? net : 0,
  };
};

module.exports = {
  calculateUserBalances,
  getUserBalanceSummary,
  calculateGroupBalances,
  getFriendBalance,
};
