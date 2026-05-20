// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseStore } = require('../lib/database');
const { createServer } = require('../lib/app');

function makeConfig(tempDir, overrides = {}) {
  return {
    serviceName: 'pingme.help',
    version: 'v0.0.1',
    dbFile: path.join(tempDir, 'test.sqlite'),
    dbEncryptionKey: 'unit-test-secret',
    turnstileSiteKey: '',
    turnstileSecretKey: '',
    adminUser: 'admin',
    adminPass: 'temporary_cleartext_password',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpStartTls: true,
    ...overrides
  };
}

async function startServer(config) {
  const store = new DatabaseStore(config);
  const server = createServer({ config, store });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const close = () => new Promise((resolve) => server.close(() => { store.close(); resolve(); }));
  return { base, store, close };
}

async function postJson(base, urlPath, body) {
  const response = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}

test('readyz returns service metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, close } = await startServer(makeConfig(tempDir));

  const response = await fetch(`${base}/readyz`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'pingme.help');
  assert.equal(payload.version, 'v0.0.1');

  await close();
});

test('registration suggestion and registration create a new user', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));

  const suggestion = await postJson(base, '/api/register/suggest', {});
  assert.equal(suggestion.status, 200);
  assert.equal(typeof suggestion.data.username, 'string');

  const register = await postJson(base, '/api/register', {
    username: suggestion.data.username,
    password: 'password123',
    passwordConfirm: 'password123',
    email: 'user@example.com'
  });

  assert.equal(register.status, 200);
  const user = store.getUser(suggestion.data.username);
  assert.ok(user);
  assert.equal(user.email, 'user@example.com');

  await close();
});

test('send ping updates status and check ping can reveal burn message once', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));

  store.registerUser({
    username: 'alice',
    passwordHash: require('../lib/security').hashPassword('password123'),
    email: 'alice@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });
  store.createCodeword('alice', 'kind-orbit', '2026-05-19T00:00:00.000Z');

  const sendPing = await postJson(base, '/api/send-ping', {
    username: 'alice',
    password: 'password123',
    status: 'not_ok',
    message: 'Need help'
  });
  assert.equal(sendPing.status, 200);

  const check = await postJson(base, '/api/check-ping', {
    username: 'alice',
    codeword: 'KIND-ORBIT'
  });
  assert.equal(check.status, 200);
  assert.equal(check.data.status, false);
  assert.equal(check.data.has_message, true);

  const reveal = await postJson(base, '/api/pinger/reveal', { sessionToken: check.data.session_token });
  assert.equal(reveal.status, 200);
  assert.equal(reveal.data.message, 'Need help');

  const revealAgain = await postJson(base, '/api/pinger/reveal', { sessionToken: check.data.session_token });
  assert.equal(revealAgain.status, 200);
  assert.equal(revealAgain.data.message, '');

  await close();
});

test('admin login returns dashboard with total users and smtp settings', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));

  store.registerUser({
    username: 'sam',
    passwordHash: require('../lib/security').hashPassword('password123'),
    email: 'sam@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });

  const login = await postJson(base, '/api/login/start', {
    username: 'admin',
    password: 'temporary_cleartext_password'
  });

  assert.equal(login.status, 200);
  assert.equal(login.data.role, 'admin');
  assert.equal(login.data.dashboard.total_users, 1);
  assert.equal(typeof login.data.session_token, 'string');

  const updateSmtp = await postJson(base, '/api/admin/smtp', {
    sessionToken: login.data.session_token,
    host: 'smtp.example.com',
    port: 587,
    user: 'mailer',
    pass: 'secret',
    starttls: true
  });

  assert.equal(updateSmtp.status, 200);
  assert.equal(updateSmtp.data.smtp.host, 'smtp.example.com');

  await close();
});

test('privacy policy includes user-risk and availability language', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, close } = await startServer(makeConfig(tempDir));

  const response = await fetch(`${base}/privacy`);
  const html = await response.text();

  assert.match(html, /at your own risk/i);
  assert.match(html, /taken offline at any time/i);
  assert.match(html, /Dead Man’s Switch alternatives/i);

  await close();
});
