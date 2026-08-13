const express = require('express');
const router = express.Router();
const {
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
} = require('../controllers/friendController');
const { getFriendBalanceController } = require('../controllers/balanceController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getFriends);
router.get('/requests', protect, getFriendRequests);
router.post('/request', protect, sendFriendRequest);
router.put('/:id/accept', protect, acceptFriendRequest);
router.put('/:id/reject', protect, rejectFriendRequest);
router.delete('/:id', protect, removeFriend);
router.get('/:id/balance', protect, getFriendBalanceController);

module.exports = router;
