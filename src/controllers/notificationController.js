const Notification = require('../models/Notification');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const total = await Notification.countDocuments({ user: req.user._id });
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });

    const notifications = await Notification.find({ user: req.user._id })
      .populate('relatedUser', 'name username profileImage')
      .populate('relatedGroup', 'name')
      .populate('relatedExpense', 'description amount')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    return successResponse(res, 'Notifications fetched', {
      notifications,
      unreadCount,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) return errorResponse(res, 'Notification not found', 404);

    notification.isRead = true;
    await notification.save();

    return successResponse(res, 'Notification marked as read', { notification });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
    return successResponse(res, 'All notifications marked as read');
  } catch (error) {
    next(error);
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead };
