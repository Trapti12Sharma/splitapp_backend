const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { errorResponse } = require('../utils/apiResponse');

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

    // Get user from DB (exclude password)
    const user = await User.findById(decoded.id);
    if (!user) {
      return errorResponse(res, 'Not authorized, user not found', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    return errorResponse(res, 'Not authorized, invalid token', 401);
  }
};

module.exports = { protect };
