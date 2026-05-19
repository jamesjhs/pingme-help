const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseStore } = require('../lib/database');
const { createServer } = require('../lib/app');
const { BackoffLockout, hashPassword } = require('../lib/security');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(tempDir, overrides = {}) {
  return {
    serviceName: 'pingme.help',
    version: 'v0.0.1',
    dbFile: path.join(tempDir, 'test.sqlite'),
    dbEncryptionKey: 'unit-test-secret',
    // Leaving turnstileSecretKey empty bypasses Turnstile verification so
    // integration tests can reach credential-checking logic directly.
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
  return { base, store, server, close };
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

// ── /readyz ───────────────────────────────────────────────────────────────────

test('readyz returns service metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const config = makeConfig(tempDir);
  const { base, close } = await startServer(config);

  const response = await fetch(`${base}/readyz`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'pingme.help');
  assert.equal(payload.version, 'v0.0.1');
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  await close();
});

// ── Database integrity ────────────────────────────────────────────────────────

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

// ── BackoffLockout unit tests ─────────────────────────────────────────────────

test('BackoffLockout: allows requests before reaching the failure threshold', () => {
  const bl = new BackoffLockout();

  assert.deepEqual(bl.check('k1'), { allowed: true });

  bl.recordFailure('k1');
  assert.deepEqual(bl.check('k1'), { allowed: true });
  bl.recordFailure('k1');
  assert.deepEqual(bl.check('k1'), { allowed: true });
});

test('BackoffLockout: locks out after 3 failures and returns retryAfterMs', () => {
  const bl = new BackoffLockout();

  bl.recordFailure('k2');
  bl.recordFailure('k2');
  const result = bl.recordFailure('k2'); // 3rd failure → lockout

  assert.equal(result.locked, true);
  assert.ok(result.retryAfterMs > 0, 'retryAfterMs should be positive');

  const check = bl.check('k2');
  assert.equal(check.allowed, false);
  assert.ok(check.retryAfterMs > 0, 'retryAfterMs should be positive');
});

test('BackoffLockout: lockout periods increase with each strike', () => {
  const bl = new BackoffLockout();

  // Force-trigger first lockout
  bl.recordFailure('k3');
  bl.recordFailure('k3');
  const r1 = bl.recordFailure('k3');
  assert.equal(r1.locked, true);
  const first = r1.retryAfterMs;

  // Simulate lock expiry by overwriting internal state
  bl._state.get('k3').lockUntil = Date.now() - 1;

  bl.recordFailure('k3');
  bl.recordFailure('k3');
  const r2 = bl.recordFailure('k3');
  assert.equal(r2.locked, true);
  const second = r2.retryAfterMs;

  assert.ok(second > first, 'Second lockout should be longer than the first');
});

test('BackoffLockout: recordSuccess resets all state', () => {
  const bl = new BackoffLockout();

  bl.recordFailure('k4');
  bl.recordFailure('k4');
  bl.recordFailure('k4'); // locked

  bl.recordSuccess('k4');

  assert.deepEqual(bl.check('k4'), { allowed: true });
  // Fresh failure count: 2 more failures should NOT re-lock
  bl.recordFailure('k4');
  bl.recordFailure('k4');
  assert.deepEqual(bl.check('k4'), { allowed: true });
});

// ── Username non-enumeration ──────────────────────────────────────────────────

test('GET /u/:username returns 200 whether or not account exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const config = makeConfig(tempDir);
  const { base, close } = await startServer(config);

  // Non-existent account — must NOT 404
  const res1 = await fetch(`${base}/u/nobody`);
  assert.equal(res1.status, 200);
  assert.match(res1.headers.get('content-type') || '', /text\/html/);

  // Existing account — also 200
  const store = new DatabaseStore(config);
  store.saveUserStatus({
    username: 'bob',
    passwordHash: hashPassword('password1'),
    status: 1,
    secretCodeword: 'secret1234',
    burnMessage: null,
    lastStatusUpdate: '2026-01-01T00:00:00.000Z',
    alertEmail: null,
    isNew: true
  });
  store.close();

  const res2 = await fetch(`${base}/u/bob`);
  assert.equal(res2.status, 200);

  await close();
});

// ── Credential lockout (integration) ─────────────────────────────────────────

test('POST /api/viewer/access: locked out after 3 wrong codewords, 429 includes Retry-After', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const config = makeConfig(tempDir);
  const { base, store, close } = await startServer(config);

  // Register a user so the codeword check is real
  store.saveUserStatus({
    username: 'carol',
    passwordHash: hashPassword('password1'),
    status: 1,
    secretCodeword: 'realcodeword',
    burnMessage: null,
    lastStatusUpdate: '2026-01-01T00:00:00.000Z',
    alertEmail: null,
    isNew: true
  });

  const wrong = { username: 'carol', codeword: 'wrongcodeword' };

  const r1 = await postJson(base, '/api/viewer/access', wrong);
  assert.equal(r1.status, 401);

  const r2 = await postJson(base, '/api/viewer/access', wrong);
  assert.equal(r2.status, 401);

  // Third failure triggers the lockout
  const r3 = await postJson(base, '/api/viewer/access', wrong);
  assert.equal(r3.status, 401);

  // Fourth attempt must be blocked
  const r4 = await postJson(base, '/api/viewer/access', wrong);
  assert.equal(r4.status, 429);
  assert.equal(r4.data.ok, false);
  assert.ok(r4.headers.get('retry-after'), 'Retry-After header must be present');
  assert.ok(Number(r4.headers.get('retry-after')) > 0, 'Retry-After must be positive');

  await close();
});

test('POST /api/status: locked out after 3 wrong passwords', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const config = makeConfig(tempDir);
  const { base, store, close } = await startServer(config);

  store.saveUserStatus({
    username: 'dave',
    passwordHash: hashPassword('correctpassword'),
    status: 1,
    secretCodeword: 'cword1234',
    burnMessage: null,
    lastStatusUpdate: '2026-01-01T00:00:00.000Z',
    alertEmail: null,
    isNew: true
  });

  const wrongAttempt = {
    username: 'dave',
    password: 'wrongpassword',
    secretCodeword: 'cword1234',
    status: 'ok'
  };

  await postJson(base, '/api/status', wrongAttempt);
  await postJson(base, '/api/status', wrongAttempt);
  await postJson(base, '/api/status', wrongAttempt);

  const r4 = await postJson(base, '/api/status', wrongAttempt);
  assert.equal(r4.status, 429);
  assert.ok(r4.headers.get('retry-after'));

  await close();
});

test('POST /api/admin/login: locked out after 3 wrong passwords', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const config = makeConfig(tempDir);
  const { base, close } = await startServer(config);

  const wrong = { username: 'admin', password: 'wrongpassword' };

  await postJson(base, '/api/admin/login', wrong);
  await postJson(base, '/api/admin/login', wrong);
  await postJson(base, '/api/admin/login', wrong);

  const r4 = await postJson(base, '/api/admin/login', wrong);
  assert.equal(r4.status, 429);
  assert.ok(r4.headers.get('retry-after'));

  await close();
});
