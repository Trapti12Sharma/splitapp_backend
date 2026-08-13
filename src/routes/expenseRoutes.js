const express = require('express');
const router = express.Router();
const { getExpenses, createExpense, getExpenseById, updateExpense, deleteExpense } = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { uploadReceipt } = require('../middleware/uploadMiddleware');
const { expenseValidators } = require('../validators/expenseValidators');

router.get('/', protect, getExpenses);
router.post('/', protect, uploadReceipt, expenseValidators, createExpense);
router.get('/:id', protect, getExpenseById);
router.put('/:id', protect, uploadReceipt, updateExpense);
router.delete('/:id', protect, deleteExpense);

module.exports = router;
