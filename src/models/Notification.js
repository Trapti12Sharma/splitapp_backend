const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'friend_request',
        'friend_accepted',
        'group_added',
        'expense_added',
        'expense_edited',
        'expense_deleted',
        'settlement_received',
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    relatedExpense: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense',
      default: null,
    },
    relatedGroup: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
