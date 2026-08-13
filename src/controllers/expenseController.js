const Expense = require('../models/Expense');
const Group = require('../models/Group');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { calculateSplits } = require('../services/splitCalculationService');
const { createNotification } = require('../services/notificationService');

// Helper to build splits from request body
const buildSplits = (splitType, amount, splitsData) => {
  if (splitType === 'equal') {
    const participants = splitsData.map((s) => s.userId);
    return calculateSplits('equal', amount, participants);
  }
  return calculateSplits(splitType, amount, [], splitsData);
};

// @desc    Get expenses for current user (with filters)
// @route   GET /api/expenses
// @access  Private
const getExpenses = async (req, res, next) => {
  try {
    const { group, category, startDate, endDate, search, sortBy = 'date', order = 'desc', page = 1, limit = 20, paidBy } = req.query;

    const query = {
      $or: [{ paidBy: req.user._id }, { 'splits.user': req.user._id }],
    };

    if (group) query.group = group;
    if (category) query.category = category;
    if (paidBy) query.paidBy = paidBy;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    if (search) {
      query.description = new RegExp(search, 'i');
    }

    const sortOrder = order === 'asc' ? 1 : -1;
    const sortField = sortBy === 'amount' ? 'amount' : 'date';

    const total = await Expense.countDocuments(query);
    const expenses = await Expense.find(query)
      .populate('paidBy', 'name username profileImage')
      .populate('splits.user', 'name username profileImage')
      .populate('group', 'name')
      .populate('createdBy', 'name username')
      .sort({ [sortField]: sortOrder })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    return successResponse(res, 'Expenses fetched', {
      expenses,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create expense
// @route   POST /api/expenses  OR  POST /api/groups/:id/expenses
// @access  Private
const createExpense = async (req, res, next) => {
  try {
    const { description, amount, currency, category, paidBy, splitType, splits: splitsData, notes, date } = req.body;
    // Only use group from body if it's a non-empty string
    const groupId = req.params.id || (req.body.group && req.body.group.trim() !== '' ? req.body.group : null);

    // If group expense, verify membership
    if (groupId) {
      const group = await Group.findById(groupId);
      if (!group) return errorResponse(res, 'Group not found', 404);
      if (!group.isMember(req.user._id)) return errorResponse(res, 'Not a member of this group', 403);
      if (!group.isMember(paidBy)) return errorResponse(res, 'PaidBy must be a group member', 400);
    }

    // Parse splits data
    let parsedSplits = splitsData;
    if (typeof splitsData === 'string') {
      try { parsedSplits = JSON.parse(splitsData); } catch { parsedSplits = []; }
    }

    // Calculate splits
    let computedSplits;
    try {
      computedSplits = buildSplits(splitType, parseFloat(amount), parsedSplits);
    } catch (err) {
      return errorResponse(res, err.message, 400);
    }

    let receipt = null;
    if (req.file) {
      receipt = `/uploads/receipts/${req.file.filename}`;
    }

    const expense = await Expense.create({
      group: groupId,
      description,
      amount: parseFloat(amount),
      currency: currency || 'INR',
      category: category || 'Other',
      paidBy,
      splitType,
      splits: computedSplits,
      notes,
      receipt,
      date: date ? new Date(date) : new Date(),
      createdBy: req.user._id,
    });

    await expense.populate([
      { path: 'paidBy', select: 'name username profileImage' },
      { path: 'splits.user', select: 'name username profileImage' },
      { path: 'group', select: 'name' },
    ]);

    // Notify all split participants except creator (safe null check)
    for (const split of expense.splits) {
      const participantId = split.user?._id?.toString() || split.user?.toString();
      if (participantId && participantId !== req.user._id.toString()) {
        await createNotification({
          userId: participantId,
          type: 'expense_added',
          title: 'New Expense Added',
          message: `${req.user.name} added "${description}" — your share: ${expense.currency} ${split.amount}`,
          relatedExpense: expense._id,
          relatedGroup: groupId || undefined,
        });
      }
    }

    return successResponse(res, 'Expense created successfully', { expense }, 201);
  } catch (error) {
    next(error);
  }
};

// @desc    Get expense by ID
// @route   GET /api/expenses/:id
// @access  Private
const getExpenseById = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id)
      .populate('paidBy', 'name username profileImage')
      .populate('splits.user', 'name username profileImage')
      .populate('group', 'name description')
      .populate('createdBy', 'name username');

    if (!expense) return errorResponse(res, 'Expense not found', 404);

    const userIdStr = req.user._id.toString();
    // Authorization: user must be paidBy, a split participant, or creator
    const isInvolved =
      (expense.paidBy?._id || expense.paidBy)?.toString() === userIdStr ||
      expense.splits.some((s) => (s.user?._id || s.user)?.toString() === userIdStr) ||
      (expense.createdBy?._id || expense.createdBy)?.toString() === userIdStr;

    if (!isInvolved) return errorResponse(res, 'Access denied', 403);

    return successResponse(res, 'Expense fetched', { expense });
  } catch (error) {
    next(error);
  }
};

// @desc    Update expense
// @route   PUT /api/expenses/:id
// @access  Private (creator or group admin)
const updateExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id).populate('group');
    if (!expense) return errorResponse(res, 'Expense not found', 404);

    // Authorization
    const isCreator = (expense.createdBy?._id || expense.createdBy)?.toString() === req.user._id.toString();
    let isAdmin = false;
    if (expense.group) {
      const group = await Group.findById(expense.group._id || expense.group);
      isAdmin = group && group.isAdmin(req.user._id);
    }
    if (!isCreator && !isAdmin) return errorResponse(res, 'Not authorized to edit this expense', 403);

    const { description, amount, currency, category, paidBy, splitType, splits: splitsData, notes, date } = req.body;

    if (description) expense.description = description;
    if (currency) expense.currency = currency;
    if (category) expense.category = category;
    if (paidBy) expense.paidBy = paidBy;
    if (notes !== undefined) expense.notes = notes;
    if (date) expense.date = new Date(date);

    // Recalculate splits if amount or splitType changes
    if (amount || splitType || splitsData) {
      const newAmount = amount ? parseFloat(amount) : expense.amount;
      const newSplitType = splitType || expense.splitType;
      let parsedSplits = splitsData || expense.splits;
      if (typeof parsedSplits === 'string') {
        try { parsedSplits = JSON.parse(parsedSplits); } catch { parsedSplits = []; }
      }

      try {
        expense.splits = buildSplits(newSplitType, newAmount, parsedSplits);
      } catch (err) {
        return errorResponse(res, err.message, 400);
      }
      expense.amount = newAmount;
      expense.splitType = newSplitType;
    }

    if (req.file) {
      expense.receipt = `/uploads/receipts/${req.file.filename}`;
    }

    await expense.save();
    await expense.populate([
      { path: 'paidBy', select: 'name username profileImage' },
      { path: 'splits.user', select: 'name username profileImage' },
    ]);

    // Notify participants
    for (const split of expense.splits) {
      const participantId = split.user._id.toString();
      if (participantId !== req.user._id.toString()) {
        await createNotification({
          userId: participantId,
          type: 'expense_edited',
          title: 'Expense Updated',
          message: `${req.user.name} updated "${expense.description}"`,
          relatedExpense: expense._id,
        });
      }
    }

    return successResponse(res, 'Expense updated successfully', { expense });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete expense
// @route   DELETE /api/expenses/:id
// @access  Private (creator or group admin)
const deleteExpense = async (req, res, next) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return errorResponse(res, 'Expense not found', 404);

    const isCreator = (expense.createdBy?._id || expense.createdBy)?.toString() === req.user._id.toString();
    let isAdmin = false;
    if (expense.group) {
      const group = await Group.findById(expense.group);
      isAdmin = group && group.isAdmin(req.user._id);
    }
    if (!isCreator && !isAdmin) return errorResponse(res, 'Not authorized to delete this expense', 403);

    // Notify participants before deletion
    for (const split of expense.splits) {
      const participantId = split.user.toString();
      if (participantId !== req.user._id.toString()) {
        await createNotification({
          userId: participantId,
          type: 'expense_deleted',
          title: 'Expense Deleted',
          message: `${req.user.name} deleted "${expense.description}"`,
          relatedGroup: expense.group,
        });
      }
    }

    await expense.deleteOne();
    return successResponse(res, 'Expense deleted successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Get group expenses
// @route   GET /api/groups/:id/expenses
// @access  Private (members only)
const getGroupExpenses = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isMember(req.user._id)) return errorResponse(res, 'Access denied', 403);

    const { page = 1, limit = 20 } = req.query;
    const total = await Expense.countDocuments({ group: req.params.id });
    const expenses = await Expense.find({ group: req.params.id })
      .populate('paidBy', 'name username profileImage')
      .populate('splits.user', 'name username profileImage')
      .populate('createdBy', 'name username')
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    return successResponse(res, 'Group expenses fetched', {
      expenses,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getExpenses, createExpense, getExpenseById, updateExpense, deleteExpense, getGroupExpenses };
