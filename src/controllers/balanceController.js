const { successResponse, errorResponse } = require('../utils/apiResponse');
const { calculateUserBalances, summariseBalanceMap, getFriendBalance } = require('../services/balanceService');
const User = require('../models/User');

// @desc    Get current user's overall balances
// @route   GET /api/balances
// @access  Private
const getUserBalances = async (req, res, next) => {
  try {
    // Build the map once and summarise it locally. This previously called
    // calculateUserBalances() and then getUserBalanceSummary(), which computed
    // the exact same map a second time — doubling the query and CPU cost.
    const balanceMap = await calculateUserBalances(req.user._id);
    const summary = summariseBalanceMap(balanceMap);

    // Enrich with user details
    const userIds = Object.keys(balanceMap);
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select('name username profileImage').lean()
      : [];

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const balances = userIds
      .map((id) => ({ user: userMap.get(id), balance: balanceMap[id] }))
      .filter((b) => b.user); // filter out any invalid references

    return successResponse(res, 'Balances fetched', { balances, summary });
  } catch (error) {
    next(error);
  }
};

// @desc    Get balance with a specific friend
// @route   GET /api/friends/:id/balance  (called from friendRoutes)
// @access  Private
const getFriendBalanceController = async (req, res, next) => {
  try {
    const friendId = req.params.id;

    // Independent of each other — no reason to await them in sequence.
    const [friend, balance] = await Promise.all([
      User.findById(friendId).select('name username profileImage').lean(),
      getFriendBalance(req.user._id, friendId),
    ]);

    if (!friend) return errorResponse(res, 'User not found', 404);

    return successResponse(res, 'Friend balance fetched', { friend, balance });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUserBalances, getFriendBalanceController };
