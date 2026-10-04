/**
 * Split Calculation Service
 * Calculates expense splits for all four split types.
 *
 * All maths is done in integer cents (paise). Working in floating-point rupees
 * and giving "the remainder" to the last person can push that last share
 * negative (e.g. ₹0.35 across 10 people rounds each share up to ₹0.04, leaving
 * -₹0.01) and lets float error leak into stored amounts. In cents, the leftover
 * paise are handed out one at a time (largest-remainder method), so the splits
 * always sum exactly to the expense and no share is ever negative.
 */

const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => c / 100;

/**
 * Divide `totalCents` in proportion to `weights` so the parts sum exactly to
 * the total. Leftover cents go to the parts with the largest fractional
 * remainder (ties → earlier participant), which is the fairest rounding.
 */
const allocateCents = (totalCents, weights) => {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const parts = exact.map(Math.floor);
  let leftover = totalCents - parts.reduce((s, p) => s + p, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; leftover > 0; k = (k + 1) % order.length, leftover--) {
    parts[order[k].i] += 1;
  }
  return parts;
};

const assertUniqueUsers = (ids) => {
  const seen = new Set();
  for (const id of ids) {
    if (!id) throw new Error('Every split must have a user');
    const key = id.toString();
    if (seen.has(key)) throw new Error('A person can only appear once in the splits');
    seen.add(key);
  }
};

/**
 * Calculate splits for an expense
 * @param {string} splitType - 'equal' | 'exact' | 'percentage' | 'shares'
 * @param {number} amount - Total expense amount
 * @param {Array} participants - Array of user IDs
 * @param {Array} splitData - Array of { userId, amount/percentage/shares } for non-equal splits
 * @returns {Array} splits - Array of { user, amount, percentage, shares }
 */
const calculateSplits = (splitType, amount, participants, splitData = []) => {
  const totalCents = toCents(amount);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  switch (splitType) {
    case 'equal': {
      const n = participants.length;
      if (n === 0) throw new Error('At least one participant is required');
      assertUniqueUsers(participants);

      const parts = allocateCents(totalCents, participants.map(() => 1));
      return participants.map((user, i) => ({ user, amount: fromCents(parts[i]) }));
    }

    case 'exact': {
      if (splitData.length === 0) throw new Error('At least one participant is required');
      assertUniqueUsers(splitData.map((s) => s.userId));

      const cents = splitData.map((s) => toCents(s.amount));
      if (cents.some((c) => !Number.isFinite(c) || c < 0)) {
        throw new Error('Split amounts must be zero or more');
      }
      const sum = cents.reduce((s, c) => s + c, 0);
      if (sum !== totalCents) {
        throw new Error(
          `Exact split amounts (${fromCents(sum).toFixed(2)}) must equal expense amount (${fromCents(totalCents).toFixed(2)})`
        );
      }

      return splitData.map((s, i) => ({ user: s.userId, amount: fromCents(cents[i]) }));
    }

    case 'percentage': {
      if (splitData.length === 0) throw new Error('At least one participant is required');
      assertUniqueUsers(splitData.map((s) => s.userId));

      const pcts = splitData.map((s) => Number(s.percentage));
      if (pcts.some((p) => !Number.isFinite(p) || p < 0)) {
        throw new Error('Percentages must be zero or more');
      }
      const totalPercent = pcts.reduce((s, p) => s + p, 0);
      if (Math.abs(totalPercent - 100) > 0.01) {
        throw new Error(`Percentages must sum to 100% (got ${totalPercent.toFixed(2)}%)`);
      }

      const parts = allocateCents(totalCents, pcts);
      return splitData.map((s, i) => ({
        user: s.userId,
        amount: fromCents(parts[i]),
        percentage: pcts[i],
      }));
    }

    case 'shares': {
      if (splitData.length === 0) throw new Error('At least one participant is required');
      assertUniqueUsers(splitData.map((s) => s.userId));

      const shares = splitData.map((s) => Number(s.shares));
      if (shares.some((sh) => !Number.isFinite(sh) || sh < 0)) {
        throw new Error('Shares must be zero or more');
      }
      const totalShares = shares.reduce((s, sh) => s + sh, 0);
      if (totalShares <= 0) throw new Error('Total shares must be greater than 0');

      const parts = allocateCents(totalCents, shares);
      return splitData.map((s, i) => ({
        user: s.userId,
        amount: fromCents(parts[i]),
        shares: shares[i],
      }));
    }

    default:
      throw new Error(`Invalid split type: ${splitType}`);
  }
};

module.exports = { calculateSplits, allocateCents, toCents, fromCents };
