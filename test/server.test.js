const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseStore } = require('../lib/database');
const { createServer } = require('../lib/app');
const { hashPassword } = require('../lib/security');

function makeConfig(tempDir) {
  return {
    serviceName: 'pingme.help',
    version: 'v0.0.1',
    dbFile: path.join(tempDir, 'test.sqlite'),
    dbEncryptionKey: 'unit-test-secret',
    turnstileSiteKey: 'test-site-key',
    turnstileSecretKey: 'test-secret',
    adminUser: 'admin',
    adminPass: 'temporary_cleartext_password',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpStartTls: true
  };
}

test('readyz returns service metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const config = makeConfig(tempDir);
  const store = new DatabaseStore(config);
  const server = createServer({ config, store });
  server.listen(0);
  await once(server, 'listening');

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'pingme.help');
  assert.equal(payload.version, 'v0.0.1');
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  await new Promise((resolve) => server.close(resolve));
  store.close();
});

test('database stores and deletes users without orphaned alerts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const store = new DatabaseStore(makeConfig(tempDir));

  const stats = store.saveUserStatus({
    username: 'alice',
    passwordHash: hashPassword('topsecret1'),
    status: 1,
    secretCodeword: 'bluebird',
    burnMessage: 'hello there',
    lastStatusUpdate: '2026-05-19T00:00:00.000Z',
    alertEmail: 'alice@example.com',
    isNew: true
  });

  assert.deepEqual(stats, {
    last_viewer_access: null,
    message_viewed_flag: 0
  });
  assert.equal(store.getAlertEmail('alice'), 'alice@example.com');
  assert.equal(store.deleteUserCompletely('alice'), 1);
  assert.equal(store.getUser('alice'), null);
  assert.equal(store.getAlertEmail('alice'), null);

  store.close();
});
