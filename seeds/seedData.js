require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Group = require('../src/models/Group');
const Expense = require('../src/models/Expense');
const Settlement = require('../src/models/Settlement');
const Notification = require('../src/models/Notification');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Friendship.deleteMany({}),
      Group.deleteMany({}),
      Expense.deleteMany({}),
      Settlement.deleteMany({}),
      Notification.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // Create users
    const password = await bcrypt.hash('password123', 12);
    const users = await User.insertMany([
      { name: 'Trapti Sharma', username: 'trapti', email: 'trapti@example.com', password },
      { name: 'Rahul Gupta', username: 'rahul', email: 'rahul@example.com', password },
      { name: 'Priya Singh', username: 'priya', email: 'priya@example.com', password },
      { name: 'Aman Verma', username: 'aman', email: 'aman@example.com', password },
      { name: 'Neha Joshi', username: 'neha', email: 'neha@example.com', password },
    ]);
    console.log(`Created ${users.length} users`);

    const [trapti, rahul, priya, aman, neha] = users;

    // Create friendships
    await Friendship.insertMany([
      { requester: trapti._id, receiver: rahul._id, status: 'accepted' },
      { requester: trapti._id, receiver: priya._id, status: 'accepted' },
      { requester: trapti._id, receiver: aman._id, status: 'accepted' },
      { requester: rahul._id, receiver: priya._id, status: 'accepted' },
      { requester: aman._id, receiver: neha._id, status: 'accepted' },
      { requester: trapti._id, receiver: neha._id, status: 'pending' },
    ]);
    console.log('Created friendships');

    // Create groups
    const roommates = await Group.create({
      name: 'Roommates',
      description: 'Shared apartment expenses',
      createdBy: trapti._id,
      members: [
        { user: trapti._id, role: 'admin', joinedAt: new Date() },
        { user: rahul._id, role: 'member', joinedAt: new Date() },
        { user: priya._id, role: 'member', joinedAt: new Date() },
      ],
    });

    const goa = await Group.create({
      name: 'Trip to Goa',
      description: 'Goa trip expenses - Dec 2024',
      createdBy: aman._id,
      members: [
        { user: aman._id, role: 'admin', joinedAt: new Date() },
        { user: trapti._id, role: 'member', joinedAt: new Date() },
        { user: rahul._id, role: 'member', joinedAt: new Date() },
        { user: neha._id, role: 'member', joinedAt: new Date() },
      ],
    });
    console.log('Created groups');

    // Create expenses
    const expenses = await Expense.insertMany([
      {
        group: roommates._id,
        description: 'Monthly Rent',
        amount: 30000,
        currency: 'INR',
        category: 'Rent',
        paidBy: trapti._id,
        splitType: 'equal',
        splits: [
          { user: trapti._id, amount: 10000 },
          { user: rahul._id, amount: 10000 },
          { user: priya._id, amount: 10000 },
        ],
        date: new Date('2024-11-01'),
        createdBy: trapti._id,
      },
      {
        group: roommates._id,
        description: 'Electricity Bill',
        amount: 1800,
        currency: 'INR',
        category: 'Utilities',
        paidBy: rahul._id,
        splitType: 'equal',
        splits: [
          { user: trapti._id, amount: 600 },
          { user: rahul._id, amount: 600 },
          { user: priya._id, amount: 600 },
        ],
        date: new Date('2024-11-05'),
        createdBy: rahul._id,
      },
      {
        group: goa._id,
        description: 'Hotel Booking',
        amount: 12000,
        currency: 'INR',
        category: 'Travel',
        paidBy: aman._id,
        splitType: 'equal',
        splits: [
          { user: aman._id, amount: 3000 },
          { user: trapti._id, amount: 3000 },
          { user: rahul._id, amount: 3000 },
          { user: neha._id, amount: 3000 },
        ],
        date: new Date('2024-12-10'),
        createdBy: aman._id,
      },
      {
        group: goa._id,
        description: 'Dinner at Beach Restaurant',
        amount: 2400,
        currency: 'INR',
        category: 'Food',
        paidBy: trapti._id,
        splitType: 'percentage',
        splits: [
          { user: aman._id, amount: 600, percentage: 25 },
          { user: trapti._id, amount: 720, percentage: 30 },
          { user: rahul._id, amount: 600, percentage: 25 },
          { user: neha._id, amount: 480, percentage: 20 },
        ],
        date: new Date('2024-12-11'),
        createdBy: trapti._id,
      },
      {
        group: roommates._id,
        description: 'Grocery Shopping',
        amount: 3600,
        currency: 'INR',
        category: 'Groceries',
        paidBy: priya._id,
        splitType: 'shares',
        splits: [
          { user: trapti._id, amount: 1800, shares: 2 },
          { user: rahul._id, amount: 900, shares: 1 },
          { user: priya._id, amount: 900, shares: 1 },
        ],
        date: new Date('2024-11-15'),
        createdBy: priya._id,
      },
      {
        // Personal expense between two friends
        group: null,
        description: 'Movie Tickets',
        amount: 800,
        currency: 'INR',
        category: 'Entertainment',
        paidBy: trapti._id,
        splitType: 'equal',
        splits: [
          { user: trapti._id, amount: 400 },
          { user: rahul._id, amount: 400 },
        ],
        date: new Date('2024-11-20'),
        createdBy: trapti._id,
      },
    ]);
    console.log(`Created ${expenses.length} expenses`);

    // Create settlements
    await Settlement.insertMany([
      {
        from: rahul._id,
        to: trapti._id,
        amount: 5000,
        currency: 'INR',
        note: 'Rent payment',
        group: roommates._id,
        createdAt: new Date('2024-11-10'),
      },
      {
        from: rahul._id,
        to: aman._id,
        amount: 3000,
        currency: 'INR',
        note: 'Hotel payment for Goa trip',
        group: goa._id,
        createdAt: new Date('2024-12-12'),
      },
    ]);
    console.log('Created settlements');

    // Create sample notifications
    await Notification.insertMany([
      {
        user: rahul._id,
        type: 'expense_added',
        title: 'New Expense',
        message: 'Trapti added "Monthly Rent" - your share is INR 10000',
        isRead: false,
        createdAt: new Date('2024-11-01'),
      },
      {
        user: trapti._id,
        type: 'settlement_received',
        title: 'Payment Received',
        message: 'Rahul paid you INR 5000 - Rent payment',
        isRead: true,
        createdAt: new Date('2024-11-10'),
      },
    ]);
    console.log('Created notifications');

    console.log('\n✅ Seed completed successfully!');
    console.log('\nSample login credentials (password for all: password123):');
    users.forEach((u) => console.log(`  ${u.name}: ${u.email}`));
  } catch (error) {
    console.error('Seed failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

seed();
