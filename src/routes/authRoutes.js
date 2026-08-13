const express = require('express');
const router = express.Router();
const { register, login, logout, getMe, forgotPassword, resetPassword } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { uploadProfile } = require('../middleware/uploadMiddleware');
const {
  registerValidators,
  loginValidators,
  forgotPasswordValidators,
  resetPasswordValidators,
} = require('../validators/authValidators');

router.post('/register', uploadProfile, registerValidators, register);
router.post('/login', loginValidators, login);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.post('/forgot-password', forgotPasswordValidators, forgotPassword);
router.post('/reset-password', resetPasswordValidators, resetPassword);

module.exports = router;
