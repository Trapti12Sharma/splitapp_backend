const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

/**
 * Web Push (the standard browser push API) — this is what makes a notification
 * show up in the phone's notification shade when SplitApp is installed as a
 * PWA, even while the app is closed. No Firebase needed: the browser vendor's
 * push service accepts messages signed with our VAPID key pair.
 *
 * Push is optional. Without VAPID keys in the environment every call here is a
 * no-op, so local dev and tests keep working.
 */
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
const isPushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (isPushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@splitapp.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('Push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set');
}

// Keep undelivered pushes for a day — long enough for a phone that was off
// overnight, short enough that a stale "new expense" doesn't arrive next week.
const PUSH_TTL_SECONDS = 24 * 60 * 60;

/** Where tapping the notification should take the user. */
const getNotificationUrl = ({ type, relatedExpense, relatedGroup, relatedUser }) => {
  switch (type) {
    case 'expense_added':
    case 'expense_edited':
      return relatedExpense ? `/expenses/${relatedExpense}` : '/expenses';
    case 'expense_deleted':
      return relatedGroup ? `/groups/${relatedGroup}` : '/expenses';
    case 'group_added':
      return relatedGroup ? `/groups/${relatedGroup}` : '/groups';
    case 'friend_request':
      return '/friends';
    case 'friend_accepted':
    case 'payment_reminder':
      return relatedUser ? `/friends/${relatedUser}` : '/friends';
    case 'settlement_received':
      return '/settlements';
    default:
      return '/notifications';
  }
};

const sendToSubscription = async (subscription, body) => {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      body,
      { TTL: PUSH_TTL_SECONDS }
    );
  } catch (error) {
    // 404/410 mean the browser has dropped this subscription (permission
    // revoked, app uninstalled, site data cleared) — it will never work again.
    if (error.statusCode === 404 || error.statusCode === 410) {
      await PushSubscription.deleteOne({ _id: subscription._id }).catch(() => {});
    } else {
      console.error('Failed to send push notification:', error.statusCode || '', error.message);
    }
  }
};

/**
 * Send one push per notification to every device of its recipient.
 * Accepts the same payload shape as notificationService. Never throws.
 */
const sendPushForNotifications = async (payloads) => {
  if (!isPushConfigured || !payloads || payloads.length === 0) return;

  try {
    const userIds = [...new Set(payloads.map((p) => p.userId.toString()))];
    const subscriptions = await PushSubscription.find({ user: { $in: userIds } }).lean();
    if (subscriptions.length === 0) return;

    const byUser = new Map();
    for (const sub of subscriptions) {
      const key = sub.user.toString();
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(sub);
    }

    const sends = [];
    for (const payload of payloads) {
      const subs = byUser.get(payload.userId.toString());
      if (!subs) continue;

      const body = JSON.stringify({
        title: payload.title,
        body: payload.message,
        url: getNotificationUrl(payload),
      });
      for (const sub of subs) sends.push(sendToSubscription(sub, body));
    }

    await Promise.all(sends);
  } catch (error) {
    console.error('Failed to send push notifications:', error.message);
  }
};

module.exports = { isPushConfigured, sendPushForNotifications, getNotificationUrl };
