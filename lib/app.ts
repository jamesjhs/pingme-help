// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const nodemailer = require('nodemailer');
const {
  BackoffLockout,
  escapeHtml,
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

function getPublicOrigin(config, requestUrl) {
  if (['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) {
    return requestUrl.origin;
  }
  const serviceName = String(config.serviceName || '').trim();
  if (/^https?:\/\//i.test(serviceName)) {
    return serviceName.replace(/\/+$/, '');
  }
  if (serviceName && /^[a-z0-9.-]+$/i.test(serviceName)) {
    return `https://${serviceName}`;
  }
  return requestUrl.origin;
}

function buildEmailVerificationLink(config, requestUrl, username, token) {
  const link = new URL('/verify-email', getPublicOrigin(config, requestUrl));
  link.searchParams.set('username', username);
  link.searchParams.set('token', token);
  return link.toString();
}

function renderEmailVerificationResultPage(success, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Email verification | pingme.help</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body data-view="email-verification">
  <div class="shell">
    <main class="page">
      <section class="card">
        <p class="eyebrow">Email verification</p>
        <h1>${success ? 'Email verified' : 'Verification failed'}</h1>
        <p class="lede">${escapeHtml(message)}</p>
        <a class="primary-button link-button" href="/">Return to pingme.help</a>
      </section>
    </main>
  </div>
</body>
</html>`;
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

function logRequestError(method, pathName, error, level = 'error') {
  const type = error && error.constructor ? error.constructor.name : 'Error';
  const message = error && error.message ? error.message : 'Unknown error';
  const line = `[${nowIso()}] ${method} ${pathName} failed: ${type}: ${message}`;
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.error(line);
  if (error && error.stack) {
    console.error(error.stack);
  }
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
  return String(crypto.randomInt(100000, 1000000));
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
    from: config.smtpFrom || smtp.user,
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

function buildUserDashboard(store, username) {
  const user = store.getUser(username);
  return {
    private_stats: store.getPrivateStats(username),
    codewords: store.listCodewords(username),
    twofa_enabled: Boolean(user && user.twofa_enabled),
    email: user && user.email ? user.email : '',
    email_verified: Boolean(user && user.email_verified_at),
    email_verified_at: user && user.email_verified_at ? user.email_verified_at : null
  };
}

function createServer({ config, store }) {
  const lockout = new BackoffLockout();
  const homePageHtml = renderHomePage(config.turnstileSiteKey);
  const privacyPageHtml = renderPrivacyPage(config.turnstileSiteKey);

  const sessions = new Map();
  const loginChallenges = new Map();
  const resetChallenges = new Map();
  const turnstileSessions = new Map();

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
    for (const [id, value] of turnstileSessions.entries()) {
      if (value.expiresAt <= now) {
        turnstileSessions.delete(id);
      }
    }
  };

  const sendVerificationEmail = async (requestUrl, username, email) => {
    if (!email) {
      return false;
    }
    const token = randomId();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    store.setUserTwofa(
      username,
      Boolean(store.getUser(username)?.twofa_enabled),
      email,
      null,
      hashPassword(token),
      expiresAt
    );
    const link = buildEmailVerificationLink(config, requestUrl, username, token);
    const sent = await sendMail(config, store, {
      to: email,
      subject: 'Verify your pingme.help email',
      text: `Open this link to verify your email address: ${link}\n\nThis link expires in 24 hours.`
    }).catch(() => false);
    return Boolean(sent);
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

      if (method === 'GET' && url.pathname === '/verify-email') {
        const username = normalizeUsername(url.searchParams.get('username') || '');
        const token = String(url.searchParams.get('token') || '').trim();
        const user = store.getUser(username);
        const expiresAt = user && user.email_verification_expires_at
          ? Date.parse(user.email_verification_expires_at)
          : NaN;
        const valid = Boolean(
          user &&
          token &&
          user.email &&
          user.email_verification_token_hash &&
          Number.isFinite(expiresAt) &&
          expiresAt > Date.now() &&
          verifyPassword(token, user.email_verification_token_hash)
        );
        if (!valid) {
          sendHtml(response, 400, renderEmailVerificationResultPage(false, 'This verification link is invalid or has expired.'));
          return;
        }
        store.markEmailVerified(username, nowIso());
        sendHtml(response, 200, renderEmailVerificationResultPage(true, `The address ${user.email} is now verified.`));
        return;
      }

      if (method !== 'POST' || !url.pathname.startsWith('/api/')) {
        notFound(response);
        return;
      }

      const payload = await getRequestBody(request);

      const requireTurnstile = async () => {
        if (!config.turnstileSecretKey) {
          return true;
        }
        const sessionToken = String(payload.turnstileSessionToken || '');
        const session = turnstileSessions.get(sessionToken);
        if (!session || session.expiresAt <= Date.now()) {
          if (sessionToken) {
            turnstileSessions.delete(sessionToken);
          }
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return false;
        }
        return true;
      };

      if (url.pathname === '/api/turnstile/session') {
        if (!config.turnstileSecretKey) {
          sendJson(response, 200, { ok: true, bypass: true });
          return;
        }
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return;
        }
        const sessionToken = randomId();
        const expiresIn = 15 * 60 * 1000;
        turnstileSessions.set(sessionToken, { expiresAt: Date.now() + expiresIn });
        sendJson(response, 200, { ok: true, turnstile_session_token: sessionToken, expires_in_ms: expiresIn });
        return;
      }

      if (url.pathname === '/api/register/suggest') {
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
        const createdAt = nowIso();
        store.registerUser({
          username,
          passwordHash: hashPassword(password),
          email,
          createdAt
        });
        const firstCodeword = generateAdjectiveNounCodeword();
        store.createCodeword(username, firstCodeword, createdAt);
        const verificationEmailSent = await sendVerificationEmail(url, username, email);
        const sessionToken = randomId();
        sessions.set(sessionToken, {
          username,
          role: 'user',
          type: 'user'
        });
        sendJson(response, 200, {
          ok: true,
          username,
          codeword: firstCodeword,
          session_token: sessionToken,
          role: 'user',
          verification_email_sent: verificationEmailSent,
          dashboard: {
            user: buildUserDashboard(store, username)
          }
        });
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

      if (url.pathname === '/api/user/status') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        const burnMessage = sanitizeMessage(payload.message);
        const status = payload.status === 'not_ok' ? 0 : 1;
        store.saveUserStatus({
          username: session.username,
          status,
          burnMessage,
          lastStatusUpdate: nowIso()
        });
        const stats = store.getPrivateStats(session.username);
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

        const loginEmail = normalizeEmail(payload.email);
        const legacyUsername = normalizeUsername(payload.username);
        const username = loginEmail ? '' : legacyUsername;
        const password = normalizePassword(payload.password);
        if (!password || (!loginEmail && !username)) {
          sendJson(response, 400, { ok: false, error: 'Invalid input' });
          return;
        }

        const lockIdentifier = loginEmail || username;
        const lockState = lockout.check('login:' + lockIdentifier);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        let role = 'user';
        let user = loginEmail ? store.getUserByEmail(loginEmail) : store.getUser(username);
        let resolvedUsername = user && user.username ? user.username : username;

        if (!loginEmail && secureCompareText(username, config.adminUser)) {
          role = 'admin';
          resolvedUsername = config.adminUser;
          const adminPasswordHash = store.getAdminPasswordHash();
          const valid = adminPasswordHash
            ? verifyPassword(password, adminPasswordHash)
            : secureCompareText(password, config.adminPass);
          if (!valid) {
            lockout.recordFailure('login:' + lockIdentifier);
            sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
            return;
          }
        } else {
          if (!user || !verifyPassword(password, user.password_hash)) {
            lockout.recordFailure('login:' + lockIdentifier);
            sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
            return;
          }
          resolvedUsername = user.username;
        }

        lockout.recordSuccess('login:' + lockIdentifier);

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
            username: resolvedUsername,
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
            challenge_id: challengeId,
            username: resolvedUsername
          });
          return;
        }

        const sessionToken = randomId();
        const payloadSession = {
          username: resolvedUsername,
          role,
          type: role === 'admin' ? 'admin' : 'user'
        };
        sessions.set(sessionToken, payloadSession);

        sendJson(response, 200, {
          ok: true,
          requires_2fa: false,
          session_token: sessionToken,
          role,
          username: resolvedUsername,
          dashboard: {
            total_users: role === 'admin' ? store.getTotalUsers() : undefined,
            smtp: role === 'admin' ? store.getSmtpSettings(config) : undefined,
            user: role === 'user' ? buildUserDashboard(store, resolvedUsername) : undefined
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
          username: challenge.username,
          dashboard: {
            total_users: challenge.role === 'admin' ? store.getTotalUsers() : undefined,
            smtp: challenge.role === 'admin' ? store.getSmtpSettings(config) : undefined,
            user: challenge.role === 'user' ? buildUserDashboard(store, challenge.username) : undefined
          }
        });
        return;
      }

      if (url.pathname === '/api/password-reset/request') {
        if (!(await requireTurnstile())) {
          return;
        }
        const email = normalizeEmail(payload.email);
        const user = email ? store.getUserByEmail(email) : null;
        if (!user || !user.email) {
          sendJson(response, 200, { ok: true });
          return;
        }

        const code = randomCode();
        const challengeId = randomId();
        resetChallenges.set(challengeId, {
          username: user.username,
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

      if (url.pathname === '/api/user/codewords/suggest') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        if (!session.username) {
          sendJson(response, 403, { ok: false, error: 'Forbidden' });
          return;
        }
        sendJson(response, 200, { ok: true, codeword: generateAdjectiveNounCodeword() });
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
        const user = store.getUser(session.username);
        const emailChanged = !secureCompareText(user && user.email ? user.email : '', email || '');
        const emailVerifiedAt = emailChanged ? null : (user && user.email_verified_at ? user.email_verified_at : null);
        const emailVerificationTokenHash = emailChanged ? null : (user && user.email_verification_token_hash ? user.email_verification_token_hash : null);
        const emailVerificationExpiresAt = emailChanged ? null : (user && user.email_verification_expires_at ? user.email_verification_expires_at : null);
        store.setUserTwofa(
          session.username,
          enabled,
          email,
          emailVerifiedAt,
          emailVerificationTokenHash,
          emailVerificationExpiresAt
        );
        const verificationEmailSent = emailChanged && email
          ? await sendVerificationEmail(url, session.username, email)
          : false;
        sendJson(response, 200, {
          ok: true,
          verification_email_sent: verificationEmailSent,
          dashboard: {
            user: buildUserDashboard(store, session.username)
          }
        });
        return;
      }

      if (url.pathname === '/api/user/email-verification/resend') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        const user = store.getUser(session.username);
        if (!user || !user.email) {
          sendJson(response, 400, { ok: false, error: 'Email is not configured' });
          return;
        }
        const sent = await sendVerificationEmail(url, session.username, user.email);
        sendJson(response, 200, {
          ok: true,
          verification_email_sent: sent,
          dashboard: {
            user: buildUserDashboard(store, session.username)
          }
        });
        return;
      }

      if (url.pathname === '/api/user/password') {
        const { session } = ensureAuthedSession(payload, sessions, 'user');
        const currentPassword = normalizePassword(payload.currentPassword);
        const newPassword = normalizePassword(payload.newPassword);
        const newPasswordConfirm = normalizePassword(payload.newPasswordConfirm);
        if (!secureCompareText(newPassword, newPasswordConfirm)) {
          sendJson(response, 400, { ok: false, error: 'Passwords do not match' });
          return;
        }
        const user = store.getUser(session.username);
        if (!user || !verifyPassword(currentPassword, user.password_hash)) {
          sendJson(response, 401, { ok: false, error: 'Current password is incorrect' });
          return;
        }
        store.updatePassword(session.username, hashPassword(newPassword));
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
          sendJson(response, 200, {
            ok: true,
            role: 'user',
            dashboard: {
              user: buildUserDashboard(store, session.username)
            }
          });
          return;
        }
        sendJson(response, 200, { ok: true, role: 'pinger' });
        return;
      }

      notFound(response);
    } catch (error) {
      const message = error && error.message ? error.message : '';
      if (message === 'too large' || message === 'invalid json') {
        logRequestError(method, url.pathname, error, 'warn');
        sendJson(response, 400, { ok: false, error: 'Malformed request' });
        return;
      }

      if (message.startsWith('invalid ')) {
        logRequestError(method, url.pathname, error, 'warn');
        sendJson(response, 400, { ok: false, error: 'Invalid input' });
        return;
      }

      logRequestError(method, url.pathname, error, 'error');
      sendJson(response, 500, { ok: false, error: 'Server error' });
    }
  });
}

module.exports = {
  createServer
};
