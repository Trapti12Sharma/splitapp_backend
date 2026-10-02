require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const app = require('./app');
const connectDB = require('./config/database');

const PORT = process.env.PORT || 5000;

/**
 * Self-ping keeps Render's free tier from spinning down.
 *
 * Render idles a service after ~15 minutes with no inbound traffic.
 * GitHub Actions `schedule` cron is unreliable on free accounts — jobs
 * can be delayed 10–30 min, which means a 10-min cron still misses the
 * window. A setInterval inside the server itself fires exactly on time
 * because it runs in the same process — no external scheduler involved.
 *
 * Interval: 10 min (600 000 ms) — comfortably inside the 15-min idle window
 * even if Node's event loop is slightly busy. Uses the built-in `http` module
 * so there are no extra dependencies.
 */
const startSelfPing = (port) => {
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  const pingUrl = `http://localhost:${port}/api/health`;

  const ping = () => {
    const req = http.get(pingUrl, (res) => {
      // Drain the response so the socket is released cleanly.
      res.resume();
      console.log(`[keep-alive] self-ping → ${res.statusCode}`);
    });
    req.on('error', (err) => {
      // Non-fatal — the next interval will retry.
      console.warn(`[keep-alive] self-ping failed: ${err.message}`);
    });
    req.setTimeout(10000, () => req.destroy());
  };

  // Unref so the interval never prevents a graceful shutdown.
  const timer = setInterval(ping, INTERVAL_MS);
  timer.unref();

  console.log(`[keep-alive] self-ping scheduled every ${INTERVAL_MS / 60000} min`);
};

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);

      // Start self-ping only in production (Render). In dev the server is
      // never idle long enough to need it, and the noise clutters the console.
      if (process.env.NODE_ENV === 'production') {
        startSelfPing(PORT);
      }
    });

    // Keep-alive must exceed the proxy's idle timeout, otherwise the server can
    // close a socket the proxy is still reusing and the client sees a random
    // 502. Node's 5s default is well under most load balancers' 60s.
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 70000;
    server.requestTimeout = 60000;

    // Graceful shutdown: stop accepting new connections, let in-flight requests
    // finish, then close the database pool. Without this a deploy or restart
    // drops live requests and leaves connections dangling.
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${signal} received — shutting down gracefully`);

      const forceExit = setTimeout(() => {
        console.error('Shutdown timed out — forcing exit');
        process.exit(1);
      }, 15000);
      forceExit.unref();

      server.close(async () => {
        try {
          await mongoose.connection.close(false);
          console.log('Closed server and database connections');
          process.exit(0);
        } catch (err) {
          console.error('Error during shutdown:', err.message);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // An unhandled rejection leaves the process in an unknown state; log it
    // loudly rather than letting it silently take down a request handler.
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled promise rejection:', reason);
    });

    return server;
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
