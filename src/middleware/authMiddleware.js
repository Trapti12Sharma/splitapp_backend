const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { errorResponse } = require('../utils/apiResponse');
const TTLCache = require('../utils/ttlCache');

/**
 * Every authenticated request used to do a full `User.findById()`. That is one
 * extra round-trip per request on the hottest path in the API. We cache the
 * lean user document for a short window instead — long enough to absorb the
 * burst of parallel calls a single page load makes, short enough that a profile
 * change shows up almost immediately (and writes invalidate explicitly).
 */
const userCache = new TTLCache({ ttlMs: 30000, maxSize: 5000 });
setInterval(() => userCache.prune(), 60000).unref();

// Only the fields the app actually reads off `req.user`.
const USER_FIELDS = 'name username email profileImage createdAt updatedAt';

const invalidateUser = (userId) => userCache.delete(userId.toString());

const protect = async (req, res, next) => {
  try {
    let token;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Fallback: check cookie
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return errorResponse(res, 'Not authorized, no token', 401);
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject a malformed id before it reaches the database.
    if (!decoded.id || !mongoose.Types.ObjectId.isValid(decoded.id)) {
      return errorResponse(res, 'Not authorized, invalid token', 401);
    }

    const cacheKey = decoded.id.toString();
    let user = userCache.get(cacheKey);

    if (!user) {
      user = await User.findById(decoded.id).select(USER_FIELDS).lean();
      if (!user) {
        return errorResponse(res, 'Not authorized, user not found', 401);
      }
      userCache.set(cacheKey, user);
    }

    // `user` is a lean object shared with the cache — hand each request its own
    // copy so a controller mutating req.user cannot poison other requests.
    req.user = { ...user };
    next();
  } catch (error) {
    return errorResponse(res, 'Not authorized, invalid token', 401);
  }
};

module.exports = { protect, invalidateUser, userCache };
