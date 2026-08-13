const express = require('express');
const router = express.Router();
const { getUserBalances } = require('../controllers/balanceController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getUserBalances);

module.exports = router;
