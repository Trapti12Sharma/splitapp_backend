const express = require('express');
const router = express.Router();
const { searchUsers, getUserById, updateProfile, changePassword } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { uploadProfile } = require('../middleware/uploadMiddleware');

// Route order fix: specific routes BEFORE param routes
router.get('/search', protect, searchUsers);
router.put('/profile', protect, uploadProfile, updateProfile);
router.put('/password', protect, changePassword);
router.get('/:id', protect, getUserById);

module.exports = router;
