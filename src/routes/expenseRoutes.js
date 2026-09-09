const express = require('express');
const router = express.Router();
const { getExpenses, createExpense, getExpenseById, updateExpense, deleteExpense } = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { uploadReceipt } = require('../middleware/uploadMiddleware');
const { uploadLimiter } = require('../middleware/rateLimiters');
const { expenseValidators } = require('../validators/expenseValidators');

router.get('/', protect, getExpenses);
router.post('/', protect, uploadLimiter, uploadReceipt, expenseValidators, createExpense);
router.get('/:id', protect, getExpenseById);
router.put('/:id', protect, uploadLimiter, uploadReceipt, updateExpense);
router.delete('/:id', protect, deleteExpense);

module.exports = router;
