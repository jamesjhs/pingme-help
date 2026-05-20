// @ts-nocheck
const { loadConfig } = require('./lib/config');
const { DatabaseStore } = require('./lib/database');
const { createServer } = require('./lib/app');

// Prevent crash stack traces from reaching stderr in production.
// All sensitive context is stripped; only a generic token is emitted.
process.on('uncaughtException', (error) => {
  // Log classification only — never the full error or stack
  const type = error && error.constructor ? error.constructor.name : 'Error';
  console.error(`Unhandled exception [${type}] — exiting`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const type = reason && reason.constructor ? reason.constructor.name : 'Error';
  const message = reason && reason.message ? reason.message : 'No reason provided';
  console.error(`Unhandled promise rejection [${type}] ${message} — exiting`);
  process.exit(1);
});

let store;
let server;

try {
  const config = loadConfig();
  store = new DatabaseStore(config);
  server = createServer({ config, store });
  server.listen(config.port);

  const shutdown = () => {
    if (server) {
      server.close(() => {
        if (store) {
          store.close();
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  const type = error && error.constructor ? error.constructor.name : 'Error';
  const message = error && error.message ? error.message : 'Unknown error';
  console.error(`Boot failure [${type}] ${message}`);
  process.exit(1);
}
