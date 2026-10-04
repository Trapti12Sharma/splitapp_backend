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

  // Separate into creditors (positive) and debtors (negative). Amounts are held
  // in integer cents so repeated subtraction can't leave float crumbs behind
  // (which used to surface as phantom ₹0.01 debts or an unmatched creditor).
  const creditors = []; // { id, cents }
  const debtors = [];   // { id, cents }

  for (const [id, balance] of Object.entries(balanceMap)) {
    const cents = Math.round(balance * 100);
    if (cents > 0) {
      creditors.push({ id, cents });
    } else if (cents < 0) {
      debtors.push({ id, cents: -cents });
    }
  }

  // Sort descending for greedy matching
  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const simplified = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const settle = Math.min(debtor.cents, creditor.cents);
    simplified.push({ from: debtor.id, to: creditor.id, amount: settle / 100 });

    debtor.cents -= settle;
    creditor.cents -= settle;

    if (debtor.cents === 0) i++;
    if (creditor.cents === 0) j++;
  }

  return simplified;
};

module.exports = { simplifyDebts };
