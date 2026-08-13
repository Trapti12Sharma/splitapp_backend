const { successResponse, errorResponse } = require('../utils/apiResponse');
const { calculateUserBalances, getUserBalanceSummary, getFriendBalance } = require('../services/balanceService');
const User = require('../models/User');

// @desc    Get current user's overall balances
// @route   GET /api/balances
// @access  Private
const getUserBalances = async (req, res, next) => {
  try {
    const balanceMap = await calculateUserBalances(req.user._id);
    const summary = await getUserBalanceSummary(req.user._id);

    // Enrich with user details
    const userIds = Object.keys(balanceMap);
    const users = await User.find({ _id: { $in: userIds } }).select('name username profileImage');
    const userMap = {};
    users.forEach((u) => { userMap[u._id.toString()] = u; });

    const balances = userIds.map((id) => ({
      user: userMap[id],
      balance: balanceMap[id],
    })).filter((b) => b.user); // filter out any invalid references

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
    const friend = await User.findById(friendId).select('name username profileImage');
    if (!friend) return errorResponse(res, 'User not found', 404);

    const balance = await getFriendBalance(req.user._id, friendId);
    return successResponse(res, 'Friend balance fetched', { friend, balance });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUserBalances, getFriendBalanceController };
