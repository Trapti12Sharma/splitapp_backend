const Settlement = require('../models/Settlement');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { createNotification } = require('../services/notificationService');

// @desc    Get user's settlement history
// @route   GET /api/settlements
// @access  Private
const getSettlements = async (req, res, next) => {
  try {
    const { group, page = 1, limit = 20 } = req.query;
    const query = {
      $or: [{ from: req.user._id }, { to: req.user._id }],
    };
    if (group) query.group = group;

    const total = await Settlement.countDocuments(query);
    const settlements = await Settlement.find(query)
      .populate('from', 'name username profileImage')
      .populate('to', 'name username profileImage')
      .populate('group', 'name')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    return successResponse(res, 'Settlements fetched', {
      settlements,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a settlement
// @route   POST /api/settlements
// @access  Private
const createSettlement = async (req, res, next) => {
  try {
    const { to, amount, currency, note, group } = req.body;

    if (!to || !amount) {
      return errorResponse(res, 'Recipient and amount are required', 400);
    }
    if (to === req.user._id.toString()) {
      return errorResponse(res, 'Cannot settle with yourself', 400);
    }
    if (parseFloat(amount) <= 0) {
      return errorResponse(res, 'Amount must be greater than 0', 400);
    }

    const recipient = await User.findById(to);
    if (!recipient) return errorResponse(res, 'Recipient not found', 404);

    const settlement = await Settlement.create({
      from: req.user._id,
      to,
      amount: parseFloat(amount),
      currency: currency || 'INR',
      note,
      group: group || null,
    });

    await settlement.populate([
      { path: 'from', select: 'name username profileImage' },
      { path: 'to', select: 'name username profileImage' },
      { path: 'group', select: 'name' },
    ]);

    // Notify recipient
    await createNotification({
      userId: to,
      type: 'settlement_received',
      title: 'Payment Received',
      message: `${req.user.name} paid you ${currency || 'INR'} ${amount}${note ? ` - "${note}"` : ''}`,
      relatedUser: req.user._id,
    });

    return successResponse(res, 'Settlement recorded successfully', { settlement }, 201);
  } catch (error) {
    next(error);
  }
};

// @desc    Get settlement by ID
// @route   GET /api/settlements/:id
// @access  Private
const getSettlementById = async (req, res, next) => {
  try {
    const settlement = await Settlement.findById(req.params.id)
      .populate('from', 'name username profileImage')
      .populate('to', 'name username profileImage')
      .populate('group', 'name');

    if (!settlement) return errorResponse(res, 'Settlement not found', 404);

    const involved = settlement.from._id.toString() === req.user._id.toString() ||
      settlement.to._id.toString() === req.user._id.toString();
    if (!involved) return errorResponse(res, 'Access denied', 403);

    return successResponse(res, 'Settlement fetched', { settlement });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettlements, createSettlement, getSettlementById };
