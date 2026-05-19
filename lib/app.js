const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const nodemailer = require('nodemailer');
const {
  BackoffLockout,
  hashPassword,
  normalizeEmail,
  normalizePassword,
  normalizeSecretCodeword,
  normalizeUsername,
  nowIso,
  sanitizeMessage,
  secureCompareText,
  stripIpHeaders,
  verifyPassword
} = require('./security');
const { renderHomePage, renderPrivacyPage } = require('./pages');
const { generateAdjectiveNounCodeword, generateVerbNounUsername } = require('./wordlists');

function readAsset(filePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', filePath));
}

const ASSETS = {
  '/assets/styles.css': { body: readAsset('styles.css'), type: 'text/css; charset=utf-8' },
  '/assets/app.js': { body: readAsset('app.js'), type: 'application/javascript; charset=utf-8' }
};

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com"
].join('; ');

function applyCommonHeaders(response) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', CSP);
}

function sendJson(response, statusCode, payload) {
  applyCommonHeaders(response);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  applyCommonHeaders(response);
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendAsset(response, asset) {
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.writeHead(200, { 'Content-Type': asset.type });
  response.end(asset.body);
}

function notFound(response) {
  sendJson(response, 404, { ok: false, error: 'Not found' });
}

function sendTooManyRequests(response, retryAfterMs) {
  const retryAfterSecs = Math.ceil(retryAfterMs / 1000);
  applyCommonHeaders(response);
  response.writeHead(429, {
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(retryAfterSecs)
  });
  response.end(JSON.stringify({
    ok: false,
    error: 'Too many attempts. Try again later.',
    retry_after: retryAfterSecs
  }));
}

function getRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_192) {
        reject(new Error('too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    request.on('error', reject);
  });
}

async function verifyTurnstile(config, token) {
  if (!config.turnstileSecretKey) {
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const form = new URLSearchParams({
      secret: config.turnstileSecretKey,
      response: token
    });
    const apiResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });

    if (!apiResponse.ok) {
      return false;
    }

    const payload = await apiResponse.json();
    return Boolean(payload.success);
  } catch {
    return false;
  }
}

function randomId() {
  return crypto.randomBytes(24).toString('hex');
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createMailer(smtpSettings) {
  if (!smtpSettings.host || !smtpSettings.port || !smtpSettings.user || !smtpSettings.pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: smtpSettings.host,
    port: smtpSettings.port,
    secure: smtpSettings.port === 465,
    requireTLS: smtpSettings.starttls,
    auth: {
      user: smtpSettings.user,
      pass: smtpSettings.pass
    }
  });
}

async function sendMail(config, store, { to, subject, text }) {
  const smtp = store.getSmtpSettings(config);
  const transporter = createMailer(smtp);
  if (!transporter) {
    return false;
  }
  await transporter.sendMail({
    from: smtp.user,
    to,
    subject,
    text
  });
  transporter.close();
  return true;
}

function ensureAuthedSession(payload, sessions, expectedType = null) {
  const token = String(payload.sessionToken || '');
  const session = sessions.get(token);
  if (!session) {
    throw new Error('invalid session');
  }
  if (expectedType && session.type !== expectedType) {
    throw new Error('invalid session');
  }
  return { token, session };
}

function createServer({ config, store }) {
  const lockout = new BackoffLockout();
  const homePageHtml = renderHomePage(config.turnstileSiteKey);
  const privacyPageHtml = renderPrivacyPage(config.turnstileSiteKey);

  const sessions = new Map();
  const loginChallenges = new Map();
  const resetChallenges = new Map();

  const cleanupExpiredChallenges = () => {
    const now = Date.now();
    for (const [id, value] of loginChallenges.entries()) {
      if (value.expiresAt <= now) {
        loginChallenges.delete(id);
      }
    }
    for (const [id, value] of resetChallenges.entries()) {
      if (value.expiresAt <= now) {
        resetChallenges.delete(id);
      }
    }
  };

  return http.createServer(async (request, response) => {
    stripIpHeaders(request.headers);
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    cleanupExpiredChallenges();

    try {
      if (method === 'GET' && url.pathname === '/readyz') {
        sendJson(response, 200, {
          ok: true,
          service: config.serviceName,
          version: config.version,
          timestamp: nowIso()
        });
        return;
      }

      if (method === 'GET' && ASSETS[url.pathname]) {
        sendAsset(response, ASSETS[url.pathname]);
        return;
      }

      if (method === 'GET' && url.pathname === '/') {
        sendHtml(response, 200, homePageHtml);
        return;
      }

      if (method === 'GET' && url.pathname === '/privacy') {
        sendHtml(response, 200, privacyPageHtml);
        return;
      }

      if (method !== 'POST' || !url.pathname.startsWith('/api/')) {
        notFound(response);
        return;
      }

      const payload = await getRequestBody(request);

      const requireTurnstile = async () => {
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return false;
        }
        return true;
      };

      if (url.pathname === '/api/register/suggest') {
        if (!(await requireTurnstile())) {
          return;
        }
        for (let i = 0; i < 20; i += 1) {
          const username = generateVerbNounUsername();
          if (!store.getUser(username)) {
            sendJson(response, 200, { ok: true, username });
            return;
          }
        }
        sendJson(response, 503, { ok: false, error: 'Try again' });
        return;
      }

      if (url.pathname === '/api/register') {
        if (!(await requireTurnstile())) {
          return;
        }
        const username = normalizeUsername(payload.username);
        const password = normalizePassword(payload.password);
        const passwordConfirm = normalizePassword(payload.passwordConfirm);
        const email = normalizeEmail(payload.email);
        if (!email || !secureCompareText(password, passwordConfirm)) {
          sendJson(response, 400, { ok: false, error: 'Invalid input' });
          return;
        }
        if (store.getUser(username)) {
          sendJson(response, 409, { ok: false, error: 'Username unavailable' });
          return;
        }
        store.registerUser({
          username,
          passwordHash: hashPassword(password),
          email,
          createdAt: nowIso()
        });
        const firstCodeword = generateAdjectiveNounCodeword();
        store.createCodeword(username, firstCodeword, nowIso());
        sendJson(response, 200, { ok: true, username, codeword: firstCodeword });
        return;
      }

      if (url.pathname === '/api/send-ping') {
        if (!(await requireTurnstile())) {
          return;
        }
        const username = normalizeUsername(payload.username);
        const lockState = lockout.check('auth:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const password = normalizePassword(payload.password);
        const burnMessage = sanitizeMessage(payload.message);
        const status = payload.status === 'not_ok' ? 0 : 1;
        const user = store.getUser(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
          lockout.recordFailure('auth:' + username);
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        lockout.recordSuccess('auth:' + username);
        store.saveUserStatus({
          username,
          status,
          burnMessage,
          lastStatusUpdate: nowIso()
        });
        const stats = store.getPrivateStats(username);
        sendJson(response, 200, {
          ok: true,
          private_stats: {
            last_viewer_access: stats && stats.last_viewer_access ? stats.last_viewer_access : 'Never',
            message_viewed_flag: Boolean(stats && stats.message_viewed_flag)
          }
        });
        return;
      }

      if (url.pathname === '/api/login/start') {
        if (!(await requireTurnstile())) {
          return;
        }

        const username = normalizeUsername(payload.username);
        const password = normalizePassword(payload.password);

        const lockState = lockout.check('login:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        let role = 'user';
        let user = store.getUser(username);

        if (secureCompareText(username, config.adminUser)) {
          role = 'admin';
          const adminPasswordHash = store.getAdminPasswordHash();
          const valid = adminPasswordHash
            ? verifyPassword(password, adminPasswordHash)
            : secureCompareText(password, config.adminPass);
          if (!valid) {
            lockout.recordFailure('login:' + username);
            sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
            return;
          }
        } else {
          if (!user || !verifyPassword(password, user.password_hash)) {
            lockout.recordFailure('login:' + username);
            sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
            return;
          }
        }

        lockout.recordSuccess('login:' + username);

        const twofaEnabled = role === 'admin'
          ? store.getSetting('admin_twofa_enabled', 'false') === 'true'
          : Boolean(user.twofa_enabled);
        const twofaEmail = role === 'admin'
          ? normalizeEmail(store.getSetting('admin_twofa_email', ''))
          : normalizeEmail(user.email);

        if (twofaEnabled) {
          if (!twofaEmail) {
            sendJson(response, 400, { ok: false, error: '2FA email is not configured' });
            return;
          }

          const code = randomCode();
          const challengeId = randomId();
          loginChallenges.set(challengeId, {
            username,
            role,
            codeHash: hashPassword(code),
            expiresAt: Date.now() + 10 * 60 * 1000
          });

          await sendMail(config, store, {
            to: twofaEmail,
            subject: 'pingme.help login code',
            text: `Your login code is ${code}. It expires in 10 minutes.`
          });

          sendJson(response, 200, {
            ok: true,
            requires_2fa: true,
            challenge_id: challengeId
          });
          return;
        }

        const sessionToken = randomId();
        const payloadSession = {
          username,
          role,
          type: role === 'admin' ? 'admin' : 'user'
        };
        sessions.set(sessionToken, payloadSession);

        sendJson(response, 200, {
          ok: true,
          requires_2fa: false,
          session_token: sessionToken,
          role,
          dashboard: {
            total_users: role === 'admin' ? store.getTotalUsers() : undefined,
            smtp: role === 'admin' ? store.getSmtpSettings(config) : undefined,
            user: role === 'user'
              ? {
                private_stats: store.getPrivateStats(username),
                codewords: store.listCodewords(username),
                twofa_enabled: Boolean(user.twofa_enabled),
                email: user.email || ''
              }
              : undefined
          }
        });
        return;
      }

      if (url.pathname === '/api/login/verify-2fa') {
        if (!(await requireTurnstile())) {
          return;
        }
        const challengeId = String(payload.challengeId || '');
        const code = String(payload.code || '').trim();
        const challenge = loginChallenges.get(challengeId);
        if (!challenge || challenge.expiresAt <= Date.now() || !verifyPassword(code, challenge.codeHash)) {
          sendJson(response, 401, { ok: false, error: 'Invalid or expired code' });
          return;
        }
        loginChallenges.delete(challengeId);
        const sessionToken = randomId();
        sessions.set(sessionToken, {
          username: challenge.username,
          role: challenge.role,
          type: challenge.role === 'admin' ? 'admin' : 'user'
        });

        const user = challenge.role === 'user' ? store.getUser(challenge.username) : null;
        sendJson(response, 200, {
          ok: true,
          session_token: sessionToken,
          role: challenge.role,
          dashboard: {
            total_users: challenge.role === 'admin' ? store.getTotalUsers() : undefined,
            smtp: challenge.role === 'admin' ? store.getSmtpSettings(config) : undefined,
            user: challenge.role === 'user'
              ? {
                private_stats: store.getPrivateStats(challenge.username),
                codewords: store.listCodewords(challenge.username),
                twofa_enabled: Boolean(user && user.twofa_enabled),
                email: user && user.email ? user.email : ''
              }
              : undefined
          }
        });
        return;
      }

      if (url.pathname === '/api/password-reset/request') {
        if (!(await requireTurnstile())) {
          return;
        }
        const username = normalizeUsername(payload.username);
        const user = store.getUser(username);
        if (!user || !user.email) {
          sendJson(response, 200, { ok: true });
          return;
        }

        const code = randomCode();
        const challengeId = randomId();
        resetChallenges.set(challengeId, {
          username,
          codeHash: hashPassword(code),
          expiresAt: Date.now() + 15 * 60 * 1000
        });

        await sendMail(config, store, {
          to: user.email,
          subject: 'pingme.help password reset code',
          text: `Use this reset code: ${code}. It expires in 15 minutes.`
        });

        sendJson(response, 200, { ok: true, challenge_id: challengeId });
        return;
      }

      if (url.pathname === '/api/password-reset/confirm') {
        if (!(await requireTurnstile())) {
          return;
        }
        const challengeId = String(payload.challengeId || '');
        const code = String(payload.code || '').trim();
        const newPassword = normalizePassword(payload.newPassword);
        const challenge = resetChallenges.get(challengeId);
        if (!challenge || challenge.expiresAt <= Date.now() || !verifyPassword(code, challenge.codeHash)) {
          sendJson(response, 401, { ok: false, error: 'Invalid or expired code' });
          return;
        }
        store.updatePassword(challenge.username, hashPassword(newPassword));
        resetChallenges.delete(challengeId);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/check-ping') {
        if (!(await requireTurnstile())) {
          return;
        }

        const username = normalizeUsername(payload.username);
        const codeword = normalizeSecretCodeword(payload.codeword);
        const lockState = lockout.check('viewer:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const user = store.getUser(username);
        const codewordRow = store.getCodeword(username, codeword);
        if (!user || !codewordRow || !codewordRow.is_active) {
          lockout.recordFailure('viewer:' + username);
          sendJson(response, 401, { ok: false, error: 'Invalid codeword' });
          return;
        }

        lockout.recordSuccess('viewer:' + username);
        const now = nowIso();
        store.updateViewerAccess(username, now, codeword);

        const pingerToken = randomId();
        sessions.set(pingerToken, {
          type: 'pinger',
          username,
          codeword
        });

        sendJson(response, 200, {
          ok: true,
          session_token: pingerToken,
          status: Boolean(user.status),
          last_status_update: user.last_status_update,
          has_message: Boolean(user.burn_message)
        });
        return;
      }

      if (url.pathname === '/api/pinger/reveal') {
        const { session } = ensureAuthedSession(payload, sessions, 'pinger');
        const viewedAt = nowIso();
        const message = store.consumeBurnMessage(session.username, session.codeword, viewedAt);
        sendJson(response, 200, { ok: true, message: message || '' });
        return;
      }

      if (url.pathname === '/api/logout') {
        const token = String(payload.sessionToken || '');
        sessions.delete(token);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/user/codewords/create') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        const createdAt = nowIso();
        let codeword = String(payload.codeword || '').trim();
        if (!codeword) {
          codeword = generateAdjectiveNounCodeword();
        }
        codeword = normalizeSecretCodeword(codeword);
        if (store.getCodeword(session.username, codeword)) {
          sendJson(response, 409, { ok: false, error: 'Codeword already exists' });
          return;
        }
        store.createCodeword(session.username, codeword, createdAt);
        sendJson(response, 200, { ok: true, codewords: store.listCodewords(session.username) });
        return;
      }

      if (url.pathname === '/api/user/codewords/disable') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        const id = Number.parseInt(String(payload.id || ''), 10);
        const enabled = payload.enabled === true;
        if (!Number.isInteger(id) || id <= 0) {
          sendJson(response, 400, { ok: false, error: 'Invalid input' });
          return;
        }
        store.setCodewordActive(session.username, id, enabled);
        sendJson(response, 200, { ok: true, codewords: store.listCodewords(session.username) });
        return;
      }

      if (url.pathname === '/api/user/twofa') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        const enabled = payload.enabled === true;
        const email = normalizeEmail(payload.email);
        if (enabled && !email) {
          sendJson(response, 400, { ok: false, error: 'Email is required to enable 2FA' });
          return;
        }
        store.setUserTwofa(session.username, enabled, email);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/admin/twofa') {
        const { session } = ensureAuthedSession(payload, sessions, 'admin');
        if (session.role !== 'admin') {
          sendJson(response, 403, { ok: false, error: 'Forbidden' });
          return;
        }
        const enabled = payload.enabled === true;
        const email = normalizeEmail(payload.email);
        if (enabled && !email) {
          sendJson(response, 400, { ok: false, error: 'Email is required to enable 2FA' });
          return;
        }
        store.setSetting('admin_twofa_enabled', enabled ? 'true' : 'false');
        store.setSetting('admin_twofa_email', email || '');
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/admin/smtp') {
        const { session } = ensureAuthedSession(payload, sessions, 'admin');
        if (session.role !== 'admin') {
          sendJson(response, 403, { ok: false, error: 'Forbidden' });
          return;
        }
        const host = String(payload.host || '').trim();
        const port = Number.parseInt(String(payload.port || ''), 10);
        const user = String(payload.user || '').trim();
        const pass = String(payload.pass || '').trim();
        const starttls = payload.starttls === true;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          sendJson(response, 400, { ok: false, error: 'Invalid input' });
          return;
        }
        store.saveSmtpSettings({ host, port, user, pass, starttls });
        sendJson(response, 200, {
          ok: true,
          total_users: store.getTotalUsers(),
          smtp: store.getSmtpSettings(config)
        });
        return;
      }

      if (url.pathname === '/api/invite') {
        const { session } = ensureAuthedSession(payload, sessions);
        const email = normalizeEmail(payload.email);
        if (!email) {
          sendJson(response, 400, { ok: false, error: 'Invalid input' });
          return;
        }
        const sender = session.role === 'admin' ? 'Admin' : session.username;
        await sendMail(config, store, {
          to: email,
          subject: 'You are invited to pingme.help',
          text: `${sender} invited you to join pingme.help. Visit ${config.serviceName} to register.`
        });
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/user/delete-account') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        store.deleteUserCompletely(session.username);
        sessions.delete(String(payload.sessionToken || ''));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/session/refresh') {
        const { session } = ensureAuthedSession(payload, sessions);
        if (session.role === 'admin') {
          sendJson(response, 200, {
            ok: true,
            role: 'admin',
            dashboard: {
              total_users: store.getTotalUsers(),
              smtp: store.getSmtpSettings(config),
              twofa_enabled: store.getSetting('admin_twofa_enabled', 'false') === 'true',
              email: store.getSetting('admin_twofa_email', '')
            }
          });
          return;
        }
        if (session.type === 'user') {
          const user = store.getUser(session.username);
          sendJson(response, 200, {
            ok: true,
            role: 'user',
            dashboard: {
              user: {
                private_stats: store.getPrivateStats(session.username),
                codewords: store.listCodewords(session.username),
                twofa_enabled: Boolean(user && user.twofa_enabled),
                email: user && user.email ? user.email : ''
              }
            }
          });
          return;
        }
        sendJson(response, 200, { ok: true, role: 'pinger' });
        return;
      }

      notFound(response);
    } catch (error) {
      if (error.message === 'too large' || error.message === 'invalid json') {
        sendJson(response, 400, { ok: false, error: 'Malformed request' });
        return;
      }

      if (error.message.startsWith('invalid ')) {
        sendJson(response, 400, { ok: false, error: 'Invalid input' });
        return;
      }

      sendJson(response, 500, { ok: false, error: 'Server error' });
    }
  });
}

module.exports = {
  createServer
};
