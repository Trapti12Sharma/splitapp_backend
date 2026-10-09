
const { calculateSplits } = require('../src/services/splitCalculationService');

describe('calculateSplits', () => {
  test('should split an expense equally', () => {
    const result = calculateSplits(
      'equal',
      100,
      ['user1', 'user2']
    );

    expect(result).toEqual([
      { user: 'user1', amount: 50 },
      { user: 'user2', amount: 50 },
    ]);
  });

  test('should handle unequal remainder correctly', () => {
    const result = calculateSplits(
      'equal',
      100,
      ['user1', 'user2', 'user3']
    );

    const total = result.reduce(
      (sum, split) => sum + split.amount,
      0
    );

    expect(total).toBe(100);
  });

  test('should calculate exact splits', () => {
    const result = calculateSplits(
      'exact',
      100,
      [],
      [
        { userId: 'user1', amount: 60 },
        { userId: 'user2', amount: 40 },
      ]
    );

    expect(result).toEqual([
      { user: 'user1', amount: 60 },
      { user: 'user2', amount: 40 },
    ]);
  });

  test('should calculate percentage splits', () => {
    const result = calculateSplits(
      'percentage',
      200,
      [],
      [
        { userId: 'user1', percentage: 25 },
        { userId: 'user2', percentage: 75 },
      ]
    );

    expect(result).toEqual([
      { user: 'user1', amount: 50, percentage: 25 },
      { user: 'user2', amount: 150, percentage: 75 },
    ]);
  });

  test('should reject invalid expense amount', () => {
    expect(() => {
      calculateSplits('equal', 0, ['user1', 'user2']);
    }).toThrow('Amount must be greater than 0');
  });

  test('should reject duplicate participants', () => {
    expect(() => {
      calculateSplits(
        'equal',
        100,
        ['user1', 'user1']
      );
    }).toThrow('A person can only appear once in the splits');
  });
});