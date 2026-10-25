const PushSubscription = require('../models/PushSubscription');
const { isPushConfigured } = require('../services/pushService');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get the VAPID public key the browser needs to subscribe
// @route   GET /api/push/public-key
// @access  Private
const getPublicKey = (req, res) => {
  if (!isPushConfigured) return errorResponse(res, 'Push notifications are not configured', 503);
  return successResponse(res, 'Push public key fetched', { publicKey: process.env.VAPID_PUBLIC_KEY });
};

// @desc    Save this device's push subscription for the current user
// @route   POST /api/push/subscribe
// @access  Private
const subscribe = async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) {
      return errorResponse(res, 'Invalid push subscription', 400);
    }

    // Upsert by endpoint: re-subscribing on every app load is harmless, and a
    // device that switches accounts moves over to the new user.
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        user: req.user._id,
        endpoint,
        keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    return successResponse(res, 'Push notifications enabled', {}, 201);
  } catch (error) {
    next(error);
  }
};

// @desc    Remove this device's push subscription
// @route   POST /api/push/unsubscribe
// @access  Private
const unsubscribe = async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string') return errorResponse(res, 'Endpoint is required', 400);

    await PushSubscription.deleteOne({ endpoint, user: req.user._id });
    return successResponse(res, 'Push notifications disabled');
  } catch (error) {
    next(error);
  }
};

module.exports = { getPublicKey, subscribe, unsubscribe };
