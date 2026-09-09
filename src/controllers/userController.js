const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { invalidateUser } = require('../middleware/authMiddleware');

const PUBLIC_USER_FIELDS = '_id name username profileImage';

// @desc    Search users by name, username, or email
// @route   GET /api/users/search?q=query
// @access  Private
const searchUsers = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return errorResponse(res, 'Search query must be at least 2 characters', 400);
    }

    // Cap the input so a huge string cannot be turned into a pathological regex.
    const trimmed = q.trim().slice(0, 64);
    const sanitized = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex

    // Substring match is kept deliberately: users search for fragments of an
    // email or username, not just prefixes. The result cap plus the length cap
    // above are what keep this bounded.
    const regex = new RegExp(sanitized, 'i');

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ name: regex }, { username: regex }, { email: regex }],
    })
      .select(PUBLIC_USER_FIELDS)
      .limit(20)
      .lean();

    return successResponse(res, 'Users found', { users });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .lean();
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    return successResponse(res, 'User fetched', { user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = async (req, res, next) => {
  try {
    const { name, username, email } = req.body;
    const updates = {};
    const conflictChecks = [];

    if (name) updates.name = name.trim();

    if (username) {
      const normalised = username.toLowerCase().trim();
      updates.username = normalised;
      conflictChecks.push({ field: 'username', value: normalised });
    }
    if (email) {
      const normalised = email.toLowerCase().trim();
      updates.email = normalised;
      conflictChecks.push({ field: 'email', value: normalised });
    }

    // Both uniqueness checks in one query instead of two sequential lookups.
    if (conflictChecks.length > 0) {
      const clash = await User.findOne({
        _id: { $ne: req.user._id },
        $or: conflictChecks.map(({ field, value }) => ({ [field]: value })),
      })
        .select('username email')
        .lean();

      if (clash) {
        const conflictingUsername = conflictChecks.find(
          (c) => c.field === 'username' && clash.username === c.value
        );
        return errorResponse(
          res,
          conflictingUsername ? 'Username already taken' : 'Email already registered',
          400
        );
      }
    }

    if (req.file?.cloudinaryUrl) {
      updates.profileImage = req.file.cloudinaryUrl;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).lean();

    if (!user) return errorResponse(res, 'User not found', 404);

    // The `protect` middleware caches the user document — drop it so the next
    // request reflects this change immediately instead of serving a stale name
    // or avatar for up to the cache TTL.
    invalidateUser(req.user._id);

    delete user.password;
    delete user.resetPasswordToken;
    delete user.resetPasswordExpires;

    return successResponse(res, 'Profile updated successfully', { user });
  } catch (error) {
    next(error);
  }
};

// @desc    Change password
// @route   PUT /api/users/password
// @access  Private
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return errorResponse(res, 'Current password and new password are required', 400);
    }
    if (newPassword.length < 6) {
      return errorResponse(res, 'New password must be at least 6 characters', 400);
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return errorResponse(res, 'User not found', 404);

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return errorResponse(res, 'Current password is incorrect', 400);
    }

    user.password = newPassword;
    await user.save();

    invalidateUser(req.user._id);

    return successResponse(res, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = { searchUsers, getUserById, updateProfile, changePassword };
