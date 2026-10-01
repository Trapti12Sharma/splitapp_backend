const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const { successResponse, errorResponse } = require('../utils/apiResponse');
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return errorResponse(res, 'Group not found', 404);
    }
    const groupId = new mongoose.Types.ObjectId(req.params.id);

    const group = await Group.findById(groupId).populate('members.user', 'name username profileImage');
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isMember(req.user._id)) return errorResponse(res, 'Access denied', 403);

    // Previously: two aggregations plus a find() that pulled every expense in the
    // group into memory to build per-person totals. A single faceted aggregation
    // does all of it in one round-trip and keeps the maths in the database.
    const [facets] = await Expense.aggregate([
      { $match: { group: groupId } },
      {
        $facet: {
          totals: [
            { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
          ],
          categories: [
            { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $sort: { total: -1 } },
          ],
          paidByUser: [
            { $group: { _id: '$paidBy', totalPaid: { $sum: '$amount' }, expenseCount: { $sum: 1 } } },
          ],
          owedByUser: [
            { $unwind: '$splits' },
            // Exclude the payer's own split — the payer's "share" is part of what
            // they paid out, not a debt they owe to themselves. Without this filter,
            // a member who paid an expense gets their own share counted in totalOwed,
            // making netBalance (totalPaid - totalOwed) incorrectly close to zero.
            { $match: { $expr: { $ne: ['$splits.user', '$paidBy'] } } },
            { $group: { _id: '$splits.user', totalOwed: { $sum: '$splits.amount' } } },
          ],
        },
      },
    ]);

    const totals = facets?.totals?.[0];
    const categoryBreakdown = facets?.categories || [];

    const paidMap = new Map((facets?.paidByUser || []).map((r) => [String(r._id), r]));
    const owedMap = new Map((facets?.owedByUser || []).map((r) => [String(r._id), r]));

    const memberStats = group.members
      .filter((m) => m.user)
      .map((m) => {
        const uid = m.user._id.toString();
        const totalPaid = paidMap.get(uid)?.totalPaid || 0;
        const totalOwed = owedMap.get(uid)?.totalOwed || 0;
        return {
          user: m.user,
          role: m.role,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalOwed: Math.round(totalOwed * 100) / 100,
          netBalance: Math.round((totalPaid - totalOwed) * 100) / 100,
          expenseCount: paidMap.get(uid)?.expenseCount || 0,
        };
      });

    return successResponse(res, 'Group stats fetched', {
      totalAmount: Math.round((totals?.totalAmount || 0) * 100) / 100,
      totalExpenses: totals?.count || 0,
      memberCount: group.members.length,
      categoryBreakdown: categoryBreakdown.map((c) => ({
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
