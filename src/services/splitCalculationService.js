/**
 * Split Calculation Service
 * Calculates expense splits for all four split types.
 */

/**
 * Calculate splits for an expense
 * @param {string} splitType - 'equal' | 'exact' | 'percentage' | 'shares'
 * @param {number} amount - Total expense amount
 * @param {Array} participants - Array of user IDs
 * @param {Array} splitData - Array of { userId, amount/percentage/shares } for non-equal splits
 * @returns {Array} splits - Array of { user, amount, percentage, shares }
 */
const calculateSplits = (splitType, amount, participants, splitData = []) => {
  const splits = [];

  switch (splitType) {
    case 'equal': {
      const n = participants.length;
      if (n === 0) throw new Error('At least one participant is required');

      const perPerson = Math.round((amount / n) * 100) / 100;
      // Handle rounding: last person gets the remainder
      let remaining = amount;

      for (let i = 0; i < n; i++) {
        const splitAmount = i === n - 1
          ? Math.round(remaining * 100) / 100
          : perPerson;

        splits.push({
          user: participants[i],
          amount: splitAmount,
        });

        remaining -= perPerson;
      }
      break;
    }

    case 'exact': {
      let total = 0;
      for (const item of splitData) {
        total += item.amount;
      }

      // Allow small floating point tolerance (1 paisa / 1 cent)
      if (Math.abs(total - amount) > 0.01) {
        throw new Error(
          `Exact split amounts (${total.toFixed(2)}) must equal expense amount (${amount.toFixed(2)})`
        );
      }

      for (const item of splitData) {
        splits.push({
          user: item.userId,
          amount: Math.round(item.amount * 100) / 100,
        });
      }
      break;
    }

    case 'percentage': {
      let totalPercent = 0;
      for (const item of splitData) {
        totalPercent += item.percentage;
      }

      if (Math.abs(totalPercent - 100) > 0.01) {
        throw new Error(`Percentages must sum to 100% (got ${totalPercent.toFixed(2)}%)`);
      }

      let remaining = amount;
      for (let i = 0; i < splitData.length; i++) {
        const item = splitData[i];
        const splitAmount = i === splitData.length - 1
          ? Math.round(remaining * 100) / 100
          : Math.round((amount * item.percentage) / 100 * 100) / 100;

        splits.push({
          user: item.userId,
          amount: splitAmount,
          percentage: item.percentage,
        });

        remaining -= splitAmount;
      }
      break;
    }

    case 'shares': {
      const totalShares = splitData.reduce((sum, item) => sum + item.shares, 0);
      if (totalShares === 0) throw new Error('Total shares must be greater than 0');

      let remaining = amount;
      for (let i = 0; i < splitData.length; i++) {
        const item = splitData[i];
        const splitAmount = i === splitData.length - 1
          ? Math.round(remaining * 100) / 100
          : Math.round((amount * item.shares) / totalShares * 100) / 100;

        splits.push({
          user: item.userId,
          amount: splitAmount,
          shares: item.shares,
        });

        remaining -= splitAmount;
      }
      break;
    }

    default:
      throw new Error(`Invalid split type: ${splitType}`);
  }

  return splits;
};

module.exports = { calculateSplits };
