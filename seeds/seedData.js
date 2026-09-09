require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Group = require('../src/models/Group');
const Expense = require('../src/models/Expense');
const Settlement = require('../src/models/Settlement');
const Notification = require('../src/models/Notification');

/**
 * Demo accounts use clearly synthetic identities ("Demo User N") rather than
 * names that read as real people, so this data is unambiguously placeholder
 * content and never mistaken for someone's actual account.
 */
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
      { name: 'Demo User One', username: 'demo_user1', email: 'demo.user1@example.com', password },
      { name: 'Demo User Two', username: 'demo_user2', email: 'demo.user2@example.com', password },
      { name: 'Demo User Three', username: 'demo_user3', email: 'demo.user3@example.com', password },
      { name: 'Demo User Four', username: 'demo_user4', email: 'demo.user4@example.com', password },
      { name: 'Demo User Five', username: 'demo_user5', email: 'demo.user5@example.com', password },
    ]);
    console.log(`Created ${users.length} users`);

    const [user1, user2, user3, user4, user5] = users;

    // Create friendships
    await Friendship.insertMany([
      { requester: user1._id, receiver: user2._id, status: 'accepted' },
      { requester: user1._id, receiver: user3._id, status: 'accepted' },
      { requester: user1._id, receiver: user4._id, status: 'accepted' },
      { requester: user2._id, receiver: user3._id, status: 'accepted' },
      { requester: user4._id, receiver: user5._id, status: 'accepted' },
      { requester: user1._id, receiver: user5._id, status: 'pending' },
    ]);
    console.log('Created friendships');

    // Create groups
    const roommates = await Group.create({
      name: 'Roommates',
      description: 'Shared apartment expenses',
      createdBy: user1._id,
      members: [
        { user: user1._id, role: 'admin', joinedAt: new Date() },
        { user: user2._id, role: 'member', joinedAt: new Date() },
        { user: user3._id, role: 'member', joinedAt: new Date() },
      ],
    });

    const trip = await Group.create({
      name: 'Weekend Trip',
      description: 'Group trip expenses',
      createdBy: user4._id,
      members: [
        { user: user4._id, role: 'admin', joinedAt: new Date() },
        { user: user1._id, role: 'member', joinedAt: new Date() },
        { user: user2._id, role: 'member', joinedAt: new Date() },
        { user: user5._id, role: 'member', joinedAt: new Date() },
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
        paidBy: user1._id,
        splitType: 'equal',
        splits: [
          { user: user1._id, amount: 10000 },
          { user: user2._id, amount: 10000 },
          { user: user3._id, amount: 10000 },
        ],
        date: new Date('2024-11-01'),
        createdBy: user1._id,
      },
      {
        group: roommates._id,
        description: 'Electricity Bill',
        amount: 1800,
        currency: 'INR',
        category: 'Utilities',
        paidBy: user2._id,
        splitType: 'equal',
        splits: [
          { user: user1._id, amount: 600 },
          { user: user2._id, amount: 600 },
          { user: user3._id, amount: 600 },
        ],
        date: new Date('2024-11-05'),
        createdBy: user2._id,
      },
      {
        group: trip._id,
        description: 'Hotel Booking',
        amount: 12000,
        currency: 'INR',
        category: 'Travel',
        paidBy: user4._id,
        splitType: 'equal',
        splits: [
          { user: user4._id, amount: 3000 },
          { user: user1._id, amount: 3000 },
          { user: user2._id, amount: 3000 },
          { user: user5._id, amount: 3000 },
        ],
        date: new Date('2024-12-10'),
        createdBy: user4._id,
      },
      {
        group: trip._id,
        description: 'Dinner at Beach Restaurant',
        amount: 2400,
        currency: 'INR',
        category: 'Food',
        paidBy: user1._id,
        splitType: 'percentage',
        splits: [
          { user: user4._id, amount: 600, percentage: 25 },
          { user: user1._id, amount: 720, percentage: 30 },
          { user: user2._id, amount: 600, percentage: 25 },
          { user: user5._id, amount: 480, percentage: 20 },
        ],
        date: new Date('2024-12-11'),
        createdBy: user1._id,
      },
      {
        group: roommates._id,
        description: 'Grocery Shopping',
        amount: 3600,
        currency: 'INR',
        category: 'Groceries',
        paidBy: user3._id,
        splitType: 'shares',
        splits: [
          { user: user1._id, amount: 1800, shares: 2 },
          { user: user2._id, amount: 900, shares: 1 },
          { user: user3._id, amount: 900, shares: 1 },
        ],
        date: new Date('2024-11-15'),
        createdBy: user3._id,
      },
      {
        // Personal expense between two friends
        group: null,
        description: 'Movie Tickets',
        amount: 800,
        currency: 'INR',
        category: 'Entertainment',
        paidBy: user1._id,
        splitType: 'equal',
        splits: [
          { user: user1._id, amount: 400 },
          { user: user2._id, amount: 400 },
        ],
        date: new Date('2024-11-20'),
        createdBy: user1._id,
      },
    ]);
    console.log(`Created ${expenses.length} expenses`);

    // Create settlements
    await Settlement.insertMany([
      {
        from: user2._id,
        to: user1._id,
        amount: 5000,
        currency: 'INR',
        note: 'Rent payment',
        group: roommates._id,
        createdAt: new Date('2024-11-10'),
      },
      {
        from: user2._id,
        to: user4._id,
        amount: 3000,
        currency: 'INR',
        note: 'Hotel payment for trip',
        group: trip._id,
        createdAt: new Date('2024-12-12'),
      },
    ]);
    console.log('Created settlements');

    // Create sample notifications
    await Notification.insertMany([
      {
        user: user2._id,
        type: 'expense_added',
        title: 'New Expense',
        message: `${user1.name} added "Monthly Rent" - your share is INR 10000`,
        isRead: false,
        createdAt: new Date('2024-11-01'),
      },
      {
        user: user1._id,
        type: 'settlement_received',
        title: 'Payment Received',
        message: `${user2.name} paid you INR 5000 - Rent payment`,
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
