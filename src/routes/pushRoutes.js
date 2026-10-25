const express = require('express');
const router = express.Router();
const { getPublicKey, subscribe, unsubscribe } = require('../controllers/pushController');
const { protect } = require('../middleware/authMiddleware');

router.get('/public-key', protect, getPublicKey);
router.post('/subscribe', protect, subscribe);
router.post('/unsubscribe', protect, unsubscribe);

module.exports = router;
