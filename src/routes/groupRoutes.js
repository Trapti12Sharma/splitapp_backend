const express = require('express');
const router = express.Router();
const {
  getUserGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMember,
  getGroupBalances,
} = require('../controllers/groupController');
const { getGroupExpenses, createExpense } = require('../controllers/expenseController');
const { protect } = require('../middleware/authMiddleware');
const { uploadGroupImage, uploadReceipt } = require('../middleware/uploadMiddleware');
const { groupValidators } = require('../validators/groupValidators');

router.get('/', protect, getUserGroups);
router.post('/', protect, uploadGroupImage, groupValidators, createGroup);
router.get('/:id', protect, getGroupById);
router.put('/:id', protect, uploadGroupImage, updateGroup);
router.delete('/:id', protect, deleteGroup);
router.post('/:id/members', protect, addMembers);
router.delete('/:id/members/:userId', protect, removeMember);
router.get('/:id/balances', protect, getGroupBalances);
router.get('/:id/expenses', protect, getGroupExpenses);
router.post('/:id/expenses', protect, uploadReceipt, createExpense);

module.exports = router;
