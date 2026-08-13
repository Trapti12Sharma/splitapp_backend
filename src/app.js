const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const errorHandler = require('./middleware/errorMiddleware');

const app = express();

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS — allow client URL (supports multiple origins for dev + prod)
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  'http://localhost:5173',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // In production you can restrict this
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting - general
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

// Rate limiting - auth endpoints (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later' },
});

app.use(generalLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
module.exports.authLimiter = authLimiter;
