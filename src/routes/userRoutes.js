const express = require('express');
const router = express.Router();
const { searchUsers, getUserById, updateProfile, changePassword } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { uploadProfile } = require('../middleware/uploadMiddleware');
const { uploadLimiter } = require('../middleware/rateLimiters');

// Route order fix: specific routes BEFORE param routes
router.get('/search', protect, searchUsers);
router.put('/profile', protect, uploadLimiter, uploadProfile, updateProfile);
router.put('/password', protect, changePassword);
router.get('/:id', protect, getUserById);

module.exports = router;
