/**
 * Exercises GET /api/groups/:id/export through the real Express app (auth,
 * routing, rate limiter, controller, headers) with the database layer mocked.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const mongoose = require('mongoose');

const ids = {
  member: new mongoose.Types.ObjectId(),
  outsider: new mongoose.Types.ObjectId(),
  group: new mongoose.Types.ObjectId(),
};

const users = {
  [ids.member]: { _id: ids.member, name: 'Member', username: 'member', email: 'm@example.com' },
  [ids.outsider]: { _id: ids.outsider, name: 'Outsider', username: 'outsider', email: 'o@example.com' },
};

// Minimal chainable query stub: .select()/.populate()/.sort() chain, .lean() resolves.
const query = (result) => {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
};

jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../src/models/Group', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Expense', () => ({ find: jest.fn() }));
jest.mock('../src/models/Settlement', () => ({ find: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const User = require('../src/models/User');
const Group = require('../src/models/Group');
const Expense = require('../src/models/Expense');
const Settlement = require('../src/models/Settlement');
const app = require('../src/app');

const tokenFor = (id) => jwt.sign({ id: id.toString() }, process.env.JWT_SECRET);

const groupDoc = {
  _id: ids.group,
  name: 'Flat 4B',
  description: 'Rent and bills',
  createdBy: ids.member,
  members: [{ user: ids.member, role: 'admin', joinedAt: new Date('2026-01-01') }],
  isMember(userId) {
    return this.members.some((m) => m.user.toString() === userId.toString());
  },
  toObject() {
    const { _id, name, description, createdBy, members } = this;
    return { _id, name, description, createdBy, members };
  },
};

// Binary response parser for supertest.
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeEach(() => {
  User.findById.mockImplementation((id) => query(users[id.toString()] || null));
  User.find.mockImplementation(() => query(Object.values(users)));
  Group.findById.mockImplementation((id) => Promise.resolve(id.toString() === ids.group.toString() ? groupDoc : null));
  Expense.find.mockImplementation(() =>
    query([
      {
        _id: new mongoose.Types.ObjectId(),
        description: 'Electricity',
        amount: 1200,
        currency: 'INR',
        category: 'Utilities',
        paidBy: ids.member,
        splitType: 'equal',
        splits: [{ user: ids.member, amount: 1200 }],
        date: new Date('2026-03-01T00:00:00Z'),
        createdBy: ids.member,
      },
    ])
  );
  Settlement.find.mockImplementation(() => query([]));
});

describe('GET /api/groups/:id/export', () => {
  test('requires authentication', async () => {
    const res = await request(app).get(`/api/groups/${ids.group}/export`);
    expect(res.status).toBe(401);
  });

  test('rejects non-members', async () => {
    const res = await request(app)
      .get(`/api/groups/${ids.group}/export`)
      .set('Authorization', `Bearer ${tokenFor(ids.outsider)}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('404 for an invalid or unknown group id', async () => {
    const bad = await request(app)
      .get('/api/groups/not-an-id/export')
      .set('Authorization', `Bearer ${tokenFor(ids.member)}`);
    expect(bad.status).toBe(404);

    const missing = await request(app)
      .get(`/api/groups/${new mongoose.Types.ObjectId()}/export`)
      .set('Authorization', `Bearer ${tokenFor(ids.member)}`);
    expect(missing.status).toBe(404);
  });

  test('streams a valid, named, uncached xlsx to a member', async () => {
    const res = await request(app)
      .get(`/api/groups/${ids.group}/export?tzOffset=-330`)
      .set('Authorization', `Bearer ${tokenFor(ids.member)}`)
      .set('Origin', 'http://localhost:5173')
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Flat-4B-expenses-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['access-control-expose-headers']).toContain('Content-Disposition');
    expect(Number(res.headers['content-length'])).toBe(res.body.length);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets).toHaveLength(6);
    expect(wb.getWorksheet('Summary').getCell('A1').value).toBe('Flat 4B');
  });
});
