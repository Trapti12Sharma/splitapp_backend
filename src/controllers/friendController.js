const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { createNotification } = require('../services/notificationService');
const { sendFriendRequestEmail } = require('../services/emailService');
const { calculateUserBalances } = require('../services/balanceService');

// @desc    Get friends list with balances
// @route   GET /api/friends
// @access  Private
const getFriends = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const friendships = await Friendship.find({
      $or: [{ requester: userId }, { receiver: userId }],
      status: 'accepted',
    }).populate('requester receiver', 'name username email profileImage');

    // Build list of friends
    const balanceMap = await calculateUserBalances(userId);

    const friends = friendships.map((f) => {
      const friend = f.requester._id.toString() === userId.toString() ? f.receiver : f.requester;
      const balance = balanceMap[friend._id.toString()] || 0;
      return {
        friendshipId: f._id,
        friend,
        balance,
        // positive: friend owes me; negative: I owe friend
      };
    });

    return successResponse(res, 'Friends fetched', { friends });
  } catch (error) {
    next(error);
  }
};

// @desc    Get pending friend requests
// @route   GET /api/friends/requests
// @access  Private
const getFriendRequests = async (req, res, next) => {
  try {
    const requests = await Friendship.find({
      receiver: req.user._id,
      status: 'pending',
    }).populate('requester', 'name username email profileImage');

    return successResponse(res, 'Friend requests fetched', { requests });
  } catch (error) {
    next(error);
  }
};

// @desc    Send friend request
// @route   POST /api/friends/request
// @access  Private
const sendFriendRequest = async (req, res, next) => {
  try {
    const { userId: receiverId } = req.body;
    const requesterId = req.user._id;

    if (requesterId.toString() === receiverId) {
      return errorResponse(res, 'Cannot send friend request to yourself', 400);
    }

    const receiver = await User.findById(receiverId);
    if (!receiver) return errorResponse(res, 'User not found', 404);

    // Check if friendship already exists (either direction)
    const existing = await Friendship.findOne({
      $or: [
        { requester: requesterId, receiver: receiverId },
        { requester: receiverId, receiver: requesterId },
      ],
    });

    if (existing) {
      if (existing.status === 'accepted') return errorResponse(res, 'Already friends', 400);
      if (existing.status === 'pending') return errorResponse(res, 'Friend request already sent', 400);
      if (existing.status === 'rejected') {
        // Allow re-sending
        existing.status = 'pending';
        existing.requester = requesterId;
        existing.receiver = receiverId;
        await existing.save();

        await createNotification({
          userId: receiverId,
          type: 'friend_request',
          title: 'New Friend Request',
          message: `${req.user.name} sent you a friend request`,
          relatedUser: requesterId,
        });

        sendFriendRequestEmail(receiver, req.user);
        return successResponse(res, 'Friend request sent', { friendship: existing }, 201);
      }
    }

    const friendship = await Friendship.create({ requester: requesterId, receiver: receiverId });

    await createNotification({
      userId: receiverId,
      type: 'friend_request',
      title: 'New Friend Request',
      message: `${req.user.name} sent you a friend request`,
      relatedUser: requesterId,
    });

    sendFriendRequestEmail(receiver, req.user);

    return successResponse(res, 'Friend request sent', { friendship }, 201);
  } catch (error) {
    next(error);
  }
};

// @desc    Accept friend request
// @route   PUT /api/friends/:id/accept
// @access  Private
const acceptFriendRequest = async (req, res, next) => {
  try {
    const friendship = await Friendship.findById(req.params.id).populate('requester', 'name username profileImage');

    if (!friendship) return errorResponse(res, 'Friend request not found', 404);
    if (friendship.receiver.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }
    if (friendship.status !== 'pending') {
      return errorResponse(res, 'Friend request is not pending', 400);
    }

    friendship.status = 'accepted';
    await friendship.save();

    await createNotification({
      userId: friendship.requester._id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      message: `${req.user.name} accepted your friend request`,
      relatedUser: req.user._id,
    });

    return successResponse(res, 'Friend request accepted', { friendship });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject friend request
// @route   PUT /api/friends/:id/reject
// @access  Private
const rejectFriendRequest = async (req, res, next) => {
  try {
    const friendship = await Friendship.findById(req.params.id);
    if (!friendship) return errorResponse(res, 'Friend request not found', 404);
    if (friendship.receiver.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    friendship.status = 'rejected';
    await friendship.save();

    return successResponse(res, 'Friend request rejected');
  } catch (error) {
    next(error);
  }
};

// @desc    Remove friend
// @route   DELETE /api/friends/:id
// @access  Private
const removeFriend = async (req, res, next) => {
  try {
    const friendship = await Friendship.findOne({
      _id: req.params.id,
      $or: [{ requester: req.user._id }, { receiver: req.user._id }],
      status: 'accepted',
    });

    if (!friendship) return errorResponse(res, 'Friendship not found', 404);

    await friendship.deleteOne();
    return successResponse(res, 'Friend removed successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = { getFriends, getFriendRequests, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend };
