const Expense = require('../models/Expense');
const Settlement = require('../models/Settlement');
const { successResponse } = require('../utils/apiResponse');
const { getUserBalanceSummary } = require('../services/balanceService');

// @desc    Get analytics summary
// @route   GET /api/analytics/summary
// @access  Private
const getSummary = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const balanceSummary = await getUserBalanceSummary(userId);

    // Use aggregate to avoid loading all documents into memory
    const [expenseStats] = await Expense.aggregate([
      { $match: { $or: [{ paidBy: userId }, { 'splits.user': userId }] } },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          largestExpense: { $max: '$amount' },
          // Sum amount only where paidBy == userId
          totalPaidByUser: {
            $sum: { $cond: [{ $eq: ['$paidBy', userId] }, '$amount', 0] },
          },
        },
      },
    ]);

    const totalExpensesCount = expenseStats?.totalCount || 0;
    const totalExpensesAmount = expenseStats?.totalAmount || 0;
    const largestExpense = expenseStats?.largestExpense || 0;
    const totalAmountPaid = expenseStats?.totalPaidByUser || 0;
    const avgExpense = totalExpensesCount > 0 ? totalExpensesAmount / totalExpensesCount : 0;

    return successResponse(res, 'Summary fetched', {
      ...balanceSummary,
      totalExpensesCount,
      totalExpensesAmount: Math.round(totalExpensesAmount * 100) / 100,
      totalAmountPaid: Math.round(totalAmountPaid * 100) / 100,
      largestExpense: Math.round(largestExpense * 100) / 100,
      avgExpense: Math.round(avgExpense * 100) / 100,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get monthly expense data (last 12 months)
// @route   GET /api/analytics/monthly
// @access  Private
const getMonthlyExpenses = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const result = await Expense.aggregate([
      {
        $match: {
          $or: [{ paidBy: userId }, { 'splits.user': userId }],
          date: { $gte: twelveMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Fill in missing months
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const found = result.find((r) => r._id.year === year && r._id.month === month);
      monthly.push({
        year,
        month,
        label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
        total: found ? Math.round(found.total * 100) / 100 : 0,
        count: found ? found.count : 0,
      });
    }

    return successResponse(res, 'Monthly data fetched', { monthly });
  } catch (error) {
    next(error);
  }
};

// @desc    Get category breakdown
// @route   GET /api/analytics/categories
// @access  Private
const getCategoryBreakdown = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const result = await Expense.aggregate([
      {
        $match: {
          $or: [{ paidBy: userId }, { 'splits.user': userId }],
        },
      },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const categories = result.map((r) => ({
      category: r._id || 'Other',
      total: Math.round(r.total * 100) / 100,
      count: r.count,
    }));

    return successResponse(res, 'Category breakdown fetched', { categories });
  } catch (error) {
    next(error);
  }
};

// @desc    Get group spending comparison
// @route   GET /api/analytics/groups
// @access  Private
const getGroupSpending = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const result = await Expense.aggregate([
      {
        $match: {
          $or: [{ paidBy: userId }, { 'splits.user': userId }],
          group: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$group',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'groups',
          localField: '_id',
          foreignField: '_id',
          as: 'group',
        },
      },
      { $unwind: { path: '$group', preserveNullAndEmptyArrays: true } },
    ]);

    const groups = result.map((r) => ({
      group: r.group ? { _id: r.group._id, name: r.group.name } : null,
      total: Math.round(r.total * 100) / 100,
      count: r.count,
    }));

    return successResponse(res, 'Group spending fetched', { groups });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed stats for a specific group
// @route   GET /api/groups/:id/stats
// @access  Private (members only)
const getGroupStats = async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const groupId = new mongoose.Types.ObjectId(req.params.id);
    const Group = require('../models/Group');

    const group = await Group.findById(groupId).populate('members.user', 'name username profileImage');
    if (!group) return require('../utils/apiResponse').errorResponse(res, 'Group not found', 404);
    if (!group.isMember(req.user._id)) return require('../utils/apiResponse').errorResponse(res, 'Access denied', 403);

    // Total group expenses
    const [totals] = await Expense.aggregate([
      { $match: { group: groupId } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Category breakdown for this group
    const categoryBreakdown = await Expense.aggregate([
      { $match: { group: groupId } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    // Per-person stats — how much each person paid and owes in this group
    const expenses = await Expense.find({ group: groupId }).lean();
    const memberIds = group.members.filter(m => m.user).map(m => m.user._id.toString());

    const personStats = {};
    memberIds.forEach(id => {
      personStats[id] = { totalPaid: 0, totalOwed: 0, expenseCount: 0 };
    });

    for (const exp of expenses) {
      const payerId = exp.paidBy.toString();
      if (personStats[payerId] !== undefined) {
        personStats[payerId].totalPaid += exp.amount;
        personStats[payerId].expenseCount += 1;
      }
      for (const split of exp.splits) {
        const splitUserId = split.user.toString();
        if (personStats[splitUserId] !== undefined) {
          personStats[splitUserId].totalOwed += split.amount;
        }
      }
    }

    // Build enriched per-member stats
    const memberStats = group.members
      .filter(m => m.user)
      .map(m => {
        const uid = m.user._id.toString();
        const stats = personStats[uid] || { totalPaid: 0, totalOwed: 0, expenseCount: 0 };
        return {
          user: m.user,
          role: m.role,
          totalPaid: Math.round(stats.totalPaid * 100) / 100,
          totalOwed: Math.round(stats.totalOwed * 100) / 100,
          netBalance: Math.round((stats.totalPaid - stats.totalOwed) * 100) / 100,
          expenseCount: stats.expenseCount,
        };
      });

    return successResponse(res, 'Group stats fetched', {
      totalAmount: Math.round((totals?.totalAmount || 0) * 100) / 100,
      totalExpenses: totals?.count || 0,
      memberCount: group.members.length,
      categoryBreakdown: categoryBreakdown.map(c => ({
        category: c._id || 'Other',
        total: Math.round(c.total * 100) / 100,
        count: c.count,
      })),
      memberStats,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSummary, getMonthlyExpenses, getCategoryBreakdown, getGroupSpending, getGroupStats };
