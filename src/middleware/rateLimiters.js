const rateLimit = require('express-rate-limit');

/**
 * Rate limiters live in their own module rather than in app.js, because the route
 * files need them and app.js requires the route files — importing them from app.js
 * would be a circular dependency that resolves to `undefined` at load time.
 */

// General API traffic.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Raised from 300. A single dashboard load fans out to ~6 requests and every
  // client polls notifications each minute, so 300 throttled ordinary use once
  // several people shared an office/NAT IP.
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

// Auth endpoints: unauthenticated and expensive (bcrypt), so keep these tight.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later' },
});

// Uploads: bounded separately because they cost bandwidth and Cloudinary quota.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many uploads, please try again later' },
});

// Spreadsheet exports read a group's entire history and build a file in memory,
// so they cost far more than a normal read. Mounted after `protect`, so it is
// keyed per user rather than per (possibly shared) IP.
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `export:${req.user._id.toString()}`,
  message: { success: false, message: 'Too many downloads, please try again in a few minutes' },
});

module.exports = { generalLimiter, authLimiter, uploadLimiter, exportLimiter };
