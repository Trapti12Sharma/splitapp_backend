const Settlement = require('../models/Settlement');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { createNotification } = require('../services/notificationService');
const { invalidateBalances, invalidateGroupBalances } = require('../services/balanceService');

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

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));

    // Count and page are independent — issue them together instead of in sequence.
    const [total, settlements] = await Promise.all([
      Settlement.countDocuments(query),
      Settlement.find(query)
        .populate('from', 'name username profileImage')
        .populate('to', 'name username profileImage')
        .populate('group', 'name')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
    ]);

    return successResponse(res, 'Settlements fetched', {
      settlements,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a settlement
// @route   POST /api/settlements
// @access  Private
//
// Only the person who actually received the money can record a settlement.
// It used to be the opposite — whoever called this endpoint was recorded as
// the payer (`from: req.user._id`) — which let a debtor unilaterally erase
// their own debt with no confirmation from the person they supposedly paid.
// Now the caller is always the receiver (`to`); they pick who paid them.
const createSettlement = async (req, res, next) => {
  try {
    const { from, amount, currency, note, group } = req.body;

    if (!from || !amount) {
      return errorResponse(res, 'Payer and amount are required', 400);
    }
    if (from === req.user._id.toString()) {
      return errorResponse(res, 'Cannot settle with yourself', 400);
    }
    if (parseFloat(amount) <= 0) {
      return errorResponse(res, 'Amount must be greater than 0', 400);
    }

    const payer = await User.findById(from).select('_id').lean();
    if (!payer) return errorResponse(res, 'Payer not found', 404);

    const settlement = await Settlement.create({
      from,
      to: req.user._id,
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

    // A settlement changes both sides' balances.
    invalidateBalances([req.user._id, from]);
    if (group) invalidateGroupBalances(group);

    // Notify the payer that their payment was confirmed.
    await createNotification({
      userId: from,
      type: 'settlement_received',
      title: 'Payment Confirmed',
      message: `${req.user.name} confirmed receiving ${currency || 'INR'} ${amount} from you${note ? ` - "${note}"` : ''}`,
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
