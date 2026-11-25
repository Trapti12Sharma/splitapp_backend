const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { buildGroupReport } = require('../src/services/groupReportService');
const { createGroupWorkbook } = require('../src/services/groupWorkbookService');
const { computeGroupNetMap } = require('../src/services/balanceService');
const { buildFilenames, parseTzOffset } = require('../src/controllers/groupExportController');

const oid = () => new mongoose.Types.ObjectId();

const alice = { _id: oid(), name: 'Alice', username: 'alice' };
const bob = { _id: oid(), name: 'Bob', username: 'bob' };
const carol = { _id: oid(), name: 'Carol', username: 'carol' };
// Dave left the group but still appears in old expenses.
const dave = { _id: oid(), name: 'Dave', username: 'dave' };

const GROUP_NAME = 'Goa Trip & Friends 🏖️';

const makeFixture = () => {
  const group = {
    _id: oid(),
    name: GROUP_NAME,
    description: 'Beach holiday',
    createdBy: alice._id,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    members: [
      { user: alice._id, role: 'admin', joinedAt: new Date('2026-01-01T10:00:00Z') },
      { user: bob._id, role: 'member', joinedAt: new Date('2026-01-02T10:00:00Z') },
      { user: carol._id, role: 'member', joinedAt: new Date('2026-01-03T10:00:00Z') },
    ],
  };

  const expenses = [
    {
      _id: oid(),
      description: 'Hotel',
      amount: 300,
      currency: 'INR',
      category: 'Rent',
      paidBy: alice._id,
      splitType: 'equal',
      splits: [
        { user: alice._id, amount: 100 },
        { user: bob._id, amount: 100 },
        { user: carol._id, amount: 100 },
      ],
      date: new Date('2026-02-10T00:00:00Z'),
      createdBy: alice._id,
    },
    {
      _id: oid(),
      // Must stay literal text, never become a formula.
      description: '=HYPERLINK("http://evil","click")\u0001',
      amount: 100,
      currency: 'INR',
      category: 'Food',
      paidBy: bob._id,
      splitType: 'percentage',
      splits: [
        { user: bob._id, amount: 33.33, percentage: 33.33 },
        { user: carol._id, amount: 33.33, percentage: 33.33 },
        { user: dave._id, amount: 33.34, percentage: 33.34 },
      ],
      date: new Date('2026-02-05T00:00:00Z'),
      createdBy: bob._id,
    },
    {
      _id: oid(),
      description: 'Taxi',
      amount: 90.5,
      currency: 'INR',
      category: 'Transport',
      paidBy: carol._id,
      splitType: 'exact',
      // Payer paid in full for others, with no share of their own.
      splits: [
        { user: alice._id, amount: 45.25 },
        { user: bob._id, amount: 45.25 },
      ],
      date: new Date('2026-02-12T00:00:00Z'),
      createdBy: carol._id,
    },
  ];

  const settlements = [
    { _id: oid(), from: bob._id, to: alice._id, amount: 50, currency: 'INR', note: 'part', createdAt: new Date('2026-02-20T20:00:00Z') },
  ];

  return { group, expenses, settlements, users: [alice, bob, carol, dave] };
};

const build = (overrides = {}) => {
  const f = makeFixture();
  return buildGroupReport({
    ...f,
    generatedBy: { name: 'Alice' },
    generatedAt: new Date('2026-11-25T18:30:00Z'),
    ...overrides,
  });
};

describe('buildGroupReport', () => {
  test('per-person nets match the Balances tab maths and sum to zero', () => {
    const f = makeFixture();
    const report = build();
    const memberIds = f.group.members.map((m) => m.user.toString());
    const expected = computeGroupNetMap(f.expenses, f.settlements, memberIds);

    for (const p of report.people) {
      expect(p.net).toBeCloseTo(expected[p.id] ?? 0, 2);
      // net = paid − share + settle-ups paid − settle-ups received
      expect(p.net).toBeCloseTo(p.paid - p.share + p.settlementsPaid - p.settlementsReceived, 2);
    }
    const sumCents = report.people.reduce((s, p) => s + Math.round(p.net * 100), 0);
    expect(sumCents).toBe(0);
  });

  test('totals, ordering, former members and categories', () => {
    const report = build();

    expect(report.totals.amount).toBe(490.5);
    expect(report.totals.expenseCount).toBe(3);
    expect(report.group.memberCount).toBe(3);

    // Members first in group order, then former participants.
    expect(report.people.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
    expect(report.people.map((p) => p.role)).toEqual(['admin', 'member', 'member', 'former']);

    // Expenses are oldest first.
    expect(report.expenses.map((e) => e.amount)).toEqual([100, 300, 90.5]);

    // Sum of all shares equals the total spent.
    const shareTotal = report.people.reduce((s, p) => s + Math.round(p.share * 100), 0) / 100;
    expect(shareTotal).toBe(490.5);

    expect(report.categories.map((c) => c.category)).toEqual(['Rent', 'Food', 'Transport']);
    expect(report.categories[0].byPerson[alice._id.toString()]).toBe(100);
    const pctSum = report.categories.reduce((s, c) => s + c.percentage, 0);
    expect(pctSum).toBeCloseTo(1, 10);

    expect(report.totals.firstDate.toISOString()).toBe('2026-02-05T00:00:00.000Z');
    expect(report.totals.lastDate.toISOString()).toBe('2026-02-12T00:00:00.000Z');
    expect(report.currency).toEqual({ code: 'INR', symbol: '₹', mixed: false, codes: ['INR'] });
  });

  test('settle-up plan clears every balance', () => {
    const report = build();
    const net = Object.fromEntries(report.people.map((p) => [p.id, Math.round(p.net * 100)]));
    for (const t of report.settlePlan) {
      net[t.fromId] += Math.round(t.amount * 100);
      net[t.toId] -= Math.round(t.amount * 100);
    }
    expect(Object.values(net).every((c) => c === 0)).toBe(true);
  });

  test('a deleted user still counts, labelled as such', () => {
    const f = makeFixture();
    const report = buildGroupReport({
      ...f,
      users: [alice, bob, carol], // Dave's user document is gone
      generatedBy: { name: 'Alice' },
    });
    const ghost = report.people.find((p) => p.id === dave._id.toString());
    expect(ghost.name).toBe('Deleted user');
    expect(ghost.share).toBe(33.34);
  });

  test('flags mixed currencies instead of picking one symbol', () => {
    const f = makeFixture();
    f.expenses[2].currency = 'USD';
    const report = buildGroupReport({ ...f, generatedBy: { name: 'A' } });
    expect(report.currency.mixed).toBe(true);
    expect(report.currency.code).toBeNull();
    expect(report.currency.codes.sort()).toEqual(['INR', 'USD']);
  });

  test('empty group produces an empty but valid report', () => {
    const f = makeFixture();
    const report = buildGroupReport({ ...f, expenses: [], settlements: [], generatedBy: { name: 'A' } });
    expect(report.totals.amount).toBe(0);
    expect(report.totals.firstDate).toBeNull();
    expect(report.settlePlan).toEqual([]);
    expect(report.people).toHaveLength(3);
  });
});

describe('createGroupWorkbook', () => {
  const roundTrip = async (report, opts) => {
    const buffer = await createGroupWorkbook(report, opts).xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
  };

  test('has every sheet, each starting with the group name and details', async () => {
    const wb = await roundTrip(build(), { tzOffsetMinutes: -330 });
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toEqual(['Summary', 'Expenses', 'Split Breakdown', 'Balances', 'Categories', 'Settlements']);

    for (const ws of wb.worksheets) {
      expect(ws.getCell('A1').value).toBe(GROUP_NAME);
      expect(ws.getCell('A2').value).toBe('Beach holiday');
      expect(String(ws.getCell('A3').value)).toContain('Members: 3');
      expect(String(ws.getCell('A3').value)).toContain('Total spent: ₹490.50');
      // Banner is coloured
      expect(ws.getCell('A1').fill.fgColor.argb).toBe('FF4F46E5');
    }
  });

  test('user text is never turned into a formula and bad XML chars are stripped', async () => {
    const wb = await roundTrip(build());
    const ws = wb.getWorksheet('Expenses');
    let found = null;
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string' && cell.value.startsWith('=HYPERLINK')) found = cell;
      });
    });
    expect(found).not.toBeNull();
    expect(found.type).toBe(ExcelJS.ValueType.String);
    expect(found.value).toBe('=HYPERLINK("http://evil","click")');
  });

  test('expense rows carry category colour, amounts and split details', async () => {
    const wb = await roundTrip(build());
    const ws = wb.getWorksheet('Expenses');
    let hotelRow = null;
    ws.eachRow((row) => { if (row.getCell(3).value === 'Hotel') hotelRow = row; });
    expect(hotelRow).not.toBeNull();
    expect(hotelRow.getCell(4).value).toBe('Rent');
    expect(hotelRow.getCell(4).font.color.argb).toBe('FF6366F1');
    expect(hotelRow.getCell(5).value).toBe(300);
    expect(hotelRow.getCell(7).value).toBe('Alice');
    expect(hotelRow.getCell(10).value).toBe('Alice: ₹100.00  •  Bob: ₹100.00  •  Carol: ₹100.00');
    // Calendar date is not shifted by the timezone.
    expect(hotelRow.getCell(2).value.toISOString()).toBe('2026-02-10T00:00:00.000Z');
  });

  test('split matrix gives each person their share and highlights the payer', async () => {
    const report = build();
    const wb = await roundTrip(report);
    const ws = wb.getWorksheet('Split Breakdown');
    let headerRow = null;
    ws.eachRow((row, n) => { if (row.getCell(1).value === '#' && headerRow === null) headerRow = n; });
    const header = ws.getRow(headerRow);
    expect(header.getCell(7).value).toBe('Alice\n@alice');
    expect(header.getCell(10).value).toBe('Dave\n@dave\n(former)');

    let taxi = null;
    ws.eachRow((row) => { if (row.getCell(3).value === 'Taxi') taxi = row; });
    expect(taxi.getCell(7).value).toBe(45.25); // Alice
    expect(taxi.getCell(8).value).toBe(45.25); // Bob
    expect(taxi.getCell(9).value).toBe(0); // Carol paid, no share
    expect(taxi.getCell(9).fill.fgColor.argb).toBe('FFD1FAE5'); // payer = green
    expect(taxi.getCell(10).value).toBe('—'); // Dave not involved
  });

  test('balance formulas carry correct cached results', async () => {
    const report = build();
    const wb = await roundTrip(report);
    const ws = wb.getWorksheet('Balances');
    let totalRow = null;
    ws.eachRow((row) => { if (row.getCell(2).value === 'Total' && !totalRow) totalRow = row; });
    expect(totalRow.getCell(3).value.result).toBe(490.5);
    expect(totalRow.getCell(4).value.result).toBe(490.5);
    // The writer emits <v>0</v> correctly; ExcelJS's *reader* drops a cached
    // result of exactly 0 on load, so treat a missing result as 0 here.
    expect(totalRow.getCell(8).value.result ?? 0).toBe(0);
    expect(totalRow.getCell(8).value.formula).toMatch(/^ROUND\(SUM\(H\d+:H\d+\),2\)$/);

    let aliceRow = null;
    ws.eachRow((row) => { if (row.getCell(2).value === 'Alice') aliceRow = row; });
    const alicePerson = report.people.find((p) => p.name === 'Alice');
    expect(aliceRow.getCell(8).value.result).toBe(alicePerson.net);
  });

  test('settlement timestamps move into the viewer timezone', async () => {
    const wb = await roundTrip(build(), { tzOffsetMinutes: -330 }); // IST
    const ws = wb.getWorksheet('Settlements');
    let row = null;
    ws.eachRow((r) => { if (r.getCell(8).value === 'part') row = r; });
    // 20:00 UTC == 01:30 IST next day
    expect(row.getCell(2).value.toISOString()).toBe('2026-02-21T01:30:00.000Z');
  });

  test('renders empty states without throwing', async () => {
    const f = makeFixture();
    const report = buildGroupReport({ ...f, expenses: [], settlements: [], generatedBy: { name: 'A' } });
    const wb = await roundTrip(report);
    expect(wb.worksheets).toHaveLength(6);
    expect(String(wb.getWorksheet('Expenses').getCell('A3').value)).toContain('No expenses yet');
  });
});

describe('export helpers', () => {
  test('filenames are safe and dated in the viewer timezone', () => {
    const now = new Date('2026-11-25T20:00:00Z'); // already 26 Nov in IST
    const { ascii, utf8 } = buildFilenames('Goa Trip / "2026"', now, -330);
    expect(ascii).toBe('Goa-Trip-2026-expenses-2026-11-26.xlsx');
    expect(utf8).toBe('Goa-Trip-2026-expenses-2026-11-26.xlsx');

    const hindi = buildFilenames('दोस्त', now, 0);
    expect(hindi.ascii).toBe('group-expenses-2026-11-25.xlsx');
    expect(hindi.utf8).toBe('दोस्त-expenses-2026-11-25.xlsx');
  });

  test('timezone offset is validated', () => {
    expect(parseTzOffset('-330')).toBe(-330);
    expect(parseTzOffset('300')).toBe(300);
    expect(parseTzOffset('abc')).toBe(0);
    expect(parseTzOffset('99999')).toBe(0);
    expect(parseTzOffset('1.5')).toBe(0);
    expect(parseTzOffset(undefined)).toBe(0);
  });
});
