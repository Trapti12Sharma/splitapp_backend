const mongoose = require('mongoose');

/**
 * One document per browser/device that has allowed push notifications. A user
 * can have several (phone + laptop), and an endpoint is unique to one browser
 * install, so it is the natural key — if a different account signs in on the
 * same phone, the existing row is reassigned rather than duplicated.
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
