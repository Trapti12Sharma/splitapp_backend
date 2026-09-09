const mongoose = require('mongoose');

/**
 * Connect to MongoDB with a connection pool sized for concurrent traffic.
 *
 * The defaults (maxPoolSize 100, no timeouts) are fine for a handful of users but
 * behave badly under load: every request that arrives while the pool is saturated
 * waits forever instead of failing fast, and a single slow query can pile up.
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  // Keep buffering (so a brief blip recovers instead of erroring) but bound it,
  // otherwise queued operations wait forever and requests hang under load.
  mongoose.set('bufferTimeoutMS', 10000);
  mongoose.set('strictQuery', true);

  const conn = await mongoose.connect(uri, {
    // Pool sizing: enough concurrency for ~1000 users without exhausting Atlas
    // connection limits. Keep a warm floor so bursts don't pay handshake cost.
    maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '50', 10),
    minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),

    // Retire idle sockets so the pool doesn't hold dead connections.
    maxIdleTimeMS: 30000,

    // Fail fast rather than hanging a request thread.
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    waitQueueTimeoutMS: 10000,

    // Network compression — meaningfully reduces latency for the large
    // populated documents this API returns.
    compressors: ['zlib'],

    retryWrites: true,
    retryReads: true,
  });

  console.log(`MongoDB Connected: ${conn.connection.host}`);

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected — driver will attempt to reconnect');
  });
  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected');
  });

  return conn;
};

module.exports = connectDB;
