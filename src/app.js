const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const errorHandler = require('./middleware/errorMiddleware');
const { generalLimiter, authLimiter } = require('./middleware/rateLimiters');

const app = express();

// Trust proxy (required for Render, Heroku, etc. behind reverse proxy)
app.set('trust proxy', 1);

// Response bodies from this API are JSON with a lot of repeated field names, so
// they compress extremely well. This is the single cheapest latency win for
// clients on mobile connections.
app.use(
  compression({
    threshold: 1024, // don't spend CPU compressing tiny payloads
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  })
);

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Skip ETag generation — these responses are user-specific and always revalidated,
// so the hash costs CPU on every request without ever producing a 304.
app.set('etag', false);

// CORS — allow client URL (supports multiple origins for dev + prod)
//
// The `else` branch here used to call `callback(null, true)` too — meaning
// EVERY origin was approved regardless of the allowlist, while still setting
// `credentials: true`. In practice a browser can't read the response unless
// it already has a way to attach the victim's credentials (this app keeps
// its JWT in localStorage, not a cookie, so that specific abuse path was
// closed), but it's still a textbook CORS misconfiguration that any scanner
// flags immediately, and it defeated the entire point of having an
// allowlist. Non-matching origins are now actually rejected.
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'https://oursplitapp.vercel.app', // production frontend — kept as a fallback in case CLIENT_URL isn't set on the host
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // No `origin` header means the request isn't a browser cross-origin
      // call at all (curl, Postman, server-to-server, most mobile clients) —
      // there's no origin to check, so let it through.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        const err = new Error('Not allowed by CORS');
        err.statusCode = 403;
        callback(err);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // cache the preflight for a day instead of re-sending it
  })
);

app.use(generalLimiter);

// Body parsing. 10mb was well above what any JSON route needs; file uploads go
// through multer, not here, so a tight cap costs nothing and limits abuse.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(cookieParser());

// Static files for uploads (legacy local files; new uploads go to Cloudinary)
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    maxAge: '7d',
    immutable: true,
    fallthrough: true,
  })
);

// Routes
app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/friends', require('./routes/friendRoutes'));
app.use('/api/groups', require('./routes/groupRoutes'));
app.use('/api/expenses', require('./routes/expenseRoutes'));
app.use('/api/balances', require('./routes/balanceRoutes'));
app.use('/api/settlements', require('./routes/settlementRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SplitApp API is running',
    timestamp: new Date().toISOString(),
  });
});

// Readiness check — reports whether the database is actually usable, so a load
// balancer can stop routing to an instance that has lost its connection.
app.get('/api/ready', (req, res) => {
  const mongoose = require('mongoose');
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    success: connected,
    database: connected ? 'connected' : 'disconnected',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
