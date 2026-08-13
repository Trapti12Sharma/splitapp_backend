const express = require('express');
const router = express.Router();
const { getSummary, getMonthlyExpenses, getCategoryBreakdown, getGroupSpending } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

router.get('/summary', protect, getSummary);
router.get('/monthly', protect, getMonthlyExpenses);
router.get('/categories', protect, getCategoryBreakdown);
router.get('/groups', protect, getGroupSpending);

module.exports = router;
