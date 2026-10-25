const Notification = require('../models/Notification');
const { sendPushForNotifications } = require('./pushService');

const toDoc = ({ userId, type, title, message, relatedExpense, relatedGroup, relatedUser }) => ({
  user: userId,
  type,
  title,
  message,
  relatedExpense: relatedExpense || null,
  relatedGroup: relatedGroup || null,
  relatedUser: relatedUser || null,
});

const createNotification = async (payload) => {
  try {
    await Notification.create(toDoc(payload));
  } catch (error) {
    console.error('Failed to create notification:', error.message);
    // Non-blocking — notification failure should not break main flow
    return;
  }
  // Fire-and-forget: the push round-trip to the browser vendor shouldn't hold
  // up the API response. sendPushForNotifications never throws.
  sendPushForNotifications([payload]);
};

/**
 * Insert many notifications in a single round-trip.
 *
 * Callers used to `await createNotification()` inside a loop, so adding an
 * expense to a 10-person group meant 10 sequential inserts before the response
 * was sent. One `insertMany` does the same work in a single round-trip, and
 * `ordered: false` means one bad document cannot drop the rest.
 */
const createNotifications = async (payloads) => {
  if (!payloads || payloads.length === 0) return;
  try {
    await Notification.insertMany(payloads.map(toDoc), { ordered: false });
  } catch (error) {
    console.error('Failed to create notifications:', error.message);
    // Non-blocking — notification failure should not break main flow
  }
  sendPushForNotifications(payloads);
};

module.exports = { createNotification, createNotifications };
