const { loadConfig } = require('./lib/config');
const { DatabaseStore } = require('./lib/database');
const { createServer } = require('./lib/app');

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
} catch {
  console.error('Boot failure');
  process.exit(1);
}
