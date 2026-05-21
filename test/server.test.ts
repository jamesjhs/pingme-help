// @ts-nocheck
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const nodemailer = require('nodemailer');
const { hashPassword, verifyPassword } = require('../lib/security');
const { DatabaseStore } = require('../lib/database');
const { createServer } = require('../lib/app');

function makeConfig(tempDir, overrides = {}) {
  return {
    serviceName: 'pingme.help',
    version: 'v0.2.0',
    dbFile: path.join(tempDir, 'test.sqlite'),
    dbEncryptionKey: 'unit-test-secret',
    turnstileSiteKey: '',
    turnstileSecretKey: '',
    adminUser: 'admin',
    adminPass: 'temporary_cleartext_password',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpFrom: '',
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

function mockMailer() {
  const sent = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    async sendMail(message) {
      sent.push(message);
    },
    close() {}
  });
  return {
    sent,
    restore() {
      nodemailer.createTransport = original;
    }
  };
}

test('readyz returns service metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, close } = await startServer(makeConfig(tempDir));

  const response = await fetch(`${base}/readyz`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'pingme.help');
  assert.equal(payload.version, 'v0.2.0');

  await close();
});

test('pwa manifest and service worker are served', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, close } = await startServer(makeConfig(tempDir));

  const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
  const manifest = await manifestResponse.json();
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifest.display, 'standalone');
  assert.equal(Array.isArray(manifest.icons), true);
  assert.ok(manifest.icons.some((icon) => icon.src === '/assets/icon.svg'));

  const workerResponse = await fetch(`${base}/sw.js`);
  const workerText = await workerResponse.text();
  assert.equal(workerResponse.status, 200);
  assert.match(workerText, /CACHE_NAME/);
  assert.match(workerText, /pingme-help-v0\.2\.0/);
  assert.doesNotMatch(workerText, /__APP_VERSION__/);

  await close();
});

test('/api/version returns the current app version', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, close } = await startServer(makeConfig(tempDir));

  const response = await fetch(`${base}/api/version`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.version, 'v0.2.0');

  await close();
});

test('registration auto logs in and marks the email unverified until the magic link is opened', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const mailer = mockMailer();
  const { base, store, close } = await startServer(makeConfig(tempDir, {
    smtpHost: 'smtp.example.com',
    smtpUser: 'mailer',
    smtpPass: 'secret'
  }));

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
  assert.equal(typeof register.data.session_token, 'string');
  assert.equal(register.data.dashboard.user.email_verified, false);
  assert.equal(register.data.verification_email_sent, true);
  const user = store.getUser(suggestion.data.username);
  assert.ok(user);
  assert.equal(user.email, 'user@example.com');
  assert.equal(Boolean(user.email_verified_at), false);
  assert.equal(mailer.sent.length, 1);
  const link = mailer.sent[0].text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(link);

  const verifyResponse = await fetch(link);
  const verifyHtml = await verifyResponse.text();
  assert.equal(verifyResponse.status, 200);
  assert.match(verifyHtml, /Email verified/i);
  assert.ok(store.getUser(suggestion.data.username).email_verified_at);

  await close();
  mailer.restore();
});

test('registration email uses SMTP_FROM when configured', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const mailer = mockMailer();
  const { base, close } = await startServer(makeConfig(tempDir, {
    smtpHost: 'smtp.example.com',
    smtpUser: 'mailer',
    smtpFrom: 'no-reply@example.com',
    smtpPass: 'secret'
  }));

  const suggestion = await postJson(base, '/api/register/suggest', {});
  const register = await postJson(base, '/api/register', {
    username: suggestion.data.username,
    password: 'password123',
    passwordConfirm: 'password123',
    email: 'user@example.com'
  });

  assert.equal(register.status, 200);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].from, 'no-reply@example.com');

  await close();
  mailer.restore();
});

test('send ping updates status and check ping can reveal burn message once', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));

  store.registerUser({
    username: 'alice',
    passwordHash: hashPassword('password123'),
    email: 'alice@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });
  store.createCodeword('alice', 'kind-orbit', '2026-05-19T00:00:00.000Z');

  const sendPing = await postJson(base, '/api/send-ping', {
    email: 'alice@example.com',
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

test('user can follow and unfollow a username/codeword pair and check status', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));

  store.registerUser({
    username: 'owner',
    passwordHash: hashPassword('password123'),
    email: 'owner@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });
  store.createCodeword('owner', 'kind-orbit', '2026-05-19T00:00:00.000Z');
  store.saveUserStatus({
    username: 'owner',
    status: 1,
    burnMessage: 'All good',
    lastStatusUpdate: '2026-05-19T01:00:00.000Z'
  });

  store.registerUser({
    username: 'follower',
    passwordHash: hashPassword('password123'),
    email: 'follower@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });
  store.createCodeword('follower', 'steady-river', '2026-05-19T00:00:00.000Z');

  const login = await postJson(base, '/api/login/start', {
    email: 'follower@example.com',
    password: 'password123'
  });
  assert.equal(login.status, 200);

  const add = await postJson(base, '/api/user/follows/add', {
    sessionToken: login.data.session_token,
    username: 'owner',
    codeword: 'KIND-ORBIT'
  });
  assert.equal(add.status, 200);
  assert.equal(add.data.follows.length, 1);

  const check = await postJson(base, '/api/user/follows/check', {
    sessionToken: login.data.session_token,
    username: 'owner',
    codeword: 'kind-orbit'
  });
  assert.equal(check.status, 200);
  assert.equal(check.data.status, true);

  const list = await postJson(base, '/api/user/follows/list', {
    sessionToken: login.data.session_token
  });
  assert.equal(list.status, 200);
  assert.equal(list.data.follows.length, 1);
  assert.equal(list.data.follows[0].target_username, 'owner');

  const remove = await postJson(base, '/api/user/follows/remove', {
    sessionToken: login.data.session_token,
    id: list.data.follows[0].id
  });
  assert.equal(remove.status, 200);
  assert.equal(remove.data.follows.length, 0);

  await close();
});

test('admin login returns dashboard with total users and smtp settings', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));

  store.registerUser({
    username: 'sam',
    passwordHash: hashPassword('password123'),
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

test('user dashboard can resend email verification and change password', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const mailer = mockMailer();
  const { base, store, close } = await startServer(makeConfig(tempDir, {
    smtpHost: 'smtp.example.com',
    smtpUser: 'mailer',
    smtpPass: 'secret'
  }));

  store.registerUser({
    username: 'riley',
    passwordHash: hashPassword('password123'),
    email: 'riley@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });

  const login = await postJson(base, '/api/login/start', {
    email: 'riley@example.com',
    password: 'password123'
  });

  assert.equal(login.status, 200);
  assert.equal(login.data.dashboard.user.email_verified, false);

  const resend = await postJson(base, '/api/user/email-verification/resend', {
    sessionToken: login.data.session_token
  });
  assert.equal(resend.status, 200);
  assert.equal(resend.data.verification_email_sent, true);
  assert.equal(mailer.sent.length, 1);

  const passwordChange = await postJson(base, '/api/user/password', {
    sessionToken: login.data.session_token,
    currentPassword: 'password123',
    newPassword: 'betterpass123',
    newPasswordConfirm: 'betterpass123'
  });
  assert.equal(passwordChange.status, 200);
  assert.equal(verifyPassword('betterpass123', store.getUser('riley').password_hash), true);

  await close();
  mailer.restore();
});

test('password reset request accepts email address without username', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const mailer = mockMailer();
  const { base, store, close } = await startServer(makeConfig(tempDir, {
    smtpHost: 'smtp.example.com',
    smtpUser: 'mailer',
    smtpPass: 'secret'
  }));

  store.registerUser({
    username: 'jamie',
    passwordHash: hashPassword('password123'),
    email: 'jamie@example.com',
    createdAt: '2026-05-19T00:00:00.000Z'
  });

  const requestReset = await postJson(base, '/api/password-reset/request', {
    email: 'jamie@example.com'
  });

  assert.equal(requestReset.status, 200);
  assert.equal(typeof requestReset.data.challenge_id, 'string');
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].text, /reset code/i);

  await close();
  mailer.restore();
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

test('internal request errors are emitted to CLI logs with route context', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingme-help-'));
  const { base, store, close } = await startServer(makeConfig(tempDir));
  const originalConsoleError = console.error;
  const captured = [];
  console.error = (...args) => {
    captured.push(args.join(' '));
  };

  try {
    store.getTotalUsers = () => {
      throw new Error('simulated failure for diagnostics');
    };

    const login = await postJson(base, '/api/login/start', {
      username: 'admin',
      password: 'temporary_cleartext_password'
    });

    assert.equal(login.status, 500);
    assert.equal(login.data.ok, false);
    assert.equal(login.data.error, 'Server error');
    const logs = captured.join('\n');
    assert.match(logs, /\/api\/login\/start/);
    assert.match(logs, /simulated failure for diagnostics/);
  } finally {
    console.error = originalConsoleError;
    await close();
  }
});
