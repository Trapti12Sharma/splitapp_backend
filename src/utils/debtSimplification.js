/**
 * Debt Simplification Algorithm
 * Reduces the number of transactions needed to settle all debts.
 *
 * Accepts either:
 *   - an array of { from, to, amount } pairwise debt objects, OR
 *   - a pre-computed net balance map { userId: netAmount } where
 *     positive = creditor (is owed money), negative = debtor (owes money).
 *
 * Output: simplified array of { from, to, amount } objects.
 */

const simplifyDebts = (input) => {
  let balanceMap = {};

  if (Array.isArray(input)) {
    // Pairwise transaction format: { from, to, amount }
    for (const txn of input) {
      const fromKey = txn.from.toString();
      const toKey = txn.to.toString();

      if (!balanceMap[fromKey]) balanceMap[fromKey] = 0;
      if (!balanceMap[toKey]) balanceMap[toKey] = 0;

      balanceMap[fromKey] -= txn.amount; // from owes -> negative
      balanceMap[toKey] += txn.amount;   // to receives -> positive
    }
  } else {
    // Pre-computed net map: { userId: netAmount }
    // Positive = creditor, negative = debtor.
    balanceMap = { ...input };
  }

  // Separate into creditors (positive) and debtors (negative)
  const creditors = []; // { id, amount }
  const debtors = [];   // { id, amount }

  for (const [id, balance] of Object.entries(balanceMap)) {
    if (balance > 0.001) {
      creditors.push({ id, amount: balance });
    } else if (balance < -0.001) {
      debtors.push({ id, amount: Math.abs(balance) });
    }
  }

  // Sort descending for greedy matching
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const simplified = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const settleAmount = Math.min(debtor.amount, creditor.amount);
    const rounded = Math.round(settleAmount * 100) / 100;

    if (rounded > 0) {
      simplified.push({
        from: debtor.id,
        to: creditor.id,
        amount: rounded,
      });
    }

    debtor.amount -= settleAmount;
    creditor.amount -= settleAmount;

    if (debtor.amount < 0.001) i++;
    if (creditor.amount < 0.001) j++;
  }

  return simplified;
};

module.exports = { simplifyDebts };
