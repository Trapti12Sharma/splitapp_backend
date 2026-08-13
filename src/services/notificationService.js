const Notification = require('../models/Notification');

const createNotification = async ({ userId, type, title, message, relatedExpense, relatedGroup, relatedUser }) => {
  try {
    await Notification.create({
      user: userId,
      type,
      title,
      message,
      relatedExpense: relatedExpense || null,
      relatedGroup: relatedGroup || null,
      relatedUser: relatedUser || null,
    });
  } catch (error) {
    console.error('Failed to create notification:', error.message);
    // Non-blocking — notification failure should not break main flow
  }
};

module.exports = { createNotification };
