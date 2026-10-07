require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const https = require('https');
const app = require('./app');
const connectDB = require('./config/database');

const PORT = process.env.PORT || 5000;

/**
 * Self-ping keeps Render's free tier from spinning down.
 *
 * Render idles a service after 15 minutes with no *inbound* traffic — traffic
 * that arrives through its public proxy. The ping therefore has to go out to
 * the service's public URL and come back in. Pinging `localhost` (as this used
 * to) never leaves the container, so Render never saw it and the service
 * still went to sleep.
 *
 * GitHub Actions `schedule` is no substitute: its runs for this repo arrived
 * hours apart, not every 5 minutes. A setInterval in the process fires on time.
 *
 * Limitation: once the service is asleep this code isn't running, so it can't
 * wake itself. An external monitor (cron-job.org / UptimeRobot) hitting
 * /api/health covers that case — e.g. after Render restarts or redeploys.
 *
 * Render sets RENDER_EXTERNAL_URL automatically (https://<name>.onrender.com).
 */
const startSelfPing = () => {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;
  if (!baseUrl) {
    console.warn('[keep-alive] RENDER_EXTERNAL_URL not set — self-ping disabled');
    return;
  }

  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes: three chances per 15-min idle window
  const pingUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;
  const client = pingUrl.startsWith('https:') ? https : http;

  const ping = () => {
    const req = client.get(pingUrl, (res) => {
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

  console.log(`[keep-alive] self-ping ${pingUrl} every ${INTERVAL_MS / 60000} min`);
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
        startSelfPing();
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
