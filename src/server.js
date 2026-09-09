require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/database');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
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
