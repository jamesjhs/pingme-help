const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
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
const {
  renderAdminPage,
  renderHomePage,
  renderPrivacyPage,
  renderViewerPage
} = require('./pages');

function readAsset(filePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', filePath));
}

const ASSETS = {
  '/assets/styles.css': { body: readAsset('styles.css'), type: 'text/css; charset=utf-8' },
  '/assets/app.js': { body: readAsset('app.js'), type: 'application/javascript; charset=utf-8' }
};

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
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "img-src 'self' data:",
      "style-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "connect-src 'self' https://challenges.cloudflare.com"
    ].join('; ')
  );
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
  applyCommonHeaders(response);
  response.writeHead(200, { 'Content-Type': asset.type });
  response.end(asset.body);
}

function notFound(response) {
  sendJson(response, 404, { ok: false, error: 'Not found' });
}

/**
 * Emit a 429 with a Retry-After header.
 * retryAfterMs is the milliseconds remaining on the lockout.
 */
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

/**
 * Verify a Cloudflare Turnstile token.
 *
 * - If TURNSTILE_SECRET_KEY is not configured the function returns true so that
 *   deployments without Turnstile are not broken.
 * - If the key IS configured a missing or invalid token is rejected.
 */
async function verifyTurnstile(config, token) {
  // Bypass: Turnstile is not enabled on this deployment
  if (!config.turnstileSecretKey) {
    return true;
  }

  // Token is mandatory when Turnstile is configured
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

function createMailer(config) {
  if (!config.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: config.smtpStartTls,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    }
  });
}

function responseForStats(stats) {
  return {
    last_viewer_access: stats && stats.last_viewer_access ? stats.last_viewer_access : 'Never',
    message_viewed_flag: Boolean(stats && stats.message_viewed_flag)
  };
}

function createServer({ config, store }) {
  const lockout = new BackoffLockout();

  return http.createServer(async (request, response) => {
    stripIpHeaders(request.headers);
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const method = request.method === 'HEAD' ? 'GET' : request.method;

    try {
      // ── Static / read-only GET routes ────────────────────────────────────

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
        sendHtml(response, 200, renderHomePage(config.turnstileSiteKey));
        return;
      }

      if (method === 'GET' && url.pathname === '/privacy') {
        sendHtml(response, 200, renderPrivacyPage(config.turnstileSiteKey));
        return;
      }

      if (method === 'GET' && url.pathname === '/admin') {
        sendHtml(response, 200, renderAdminPage(config.turnstileSiteKey));
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/u/')) {
        // Always serve the viewer page for a validly-formatted username.
        // We do NOT check whether the account exists here because doing so
        // would allow username enumeration (attackers could distinguish 200
        // from 404 without knowing the secret codeword).
        // The API endpoint /api/viewer/access returns the same "Invalid codeword"
        // error regardless of whether the username exists.
        let username;
        try {
          username = normalizeUsername(decodeURIComponent(url.pathname.slice(3)));
        } catch {
          notFound(response);
          return;
        }
        sendHtml(response, 200, renderViewerPage(config.turnstileSiteKey, username));
        return;
      }

      // ── All mutating API routes require POST ──────────────────────────────

      if (method !== 'POST' || !url.pathname.startsWith('/api/')) {
        notFound(response);
        return;
      }

      const payload = await getRequestBody(request);

      // ── POST /api/admin/login ─────────────────────────────────────────────
      if (url.pathname === '/api/admin/login') {
        // Turnstile gate — admin login is a state-changing credential operation
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return;
        }

        const lockState = lockout.check('admin:login');
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const username = String(payload.username || '').trim();
        const password = String(payload.password || '');

        if (!secureCompareText(username, config.adminUser)) {
          lockout.recordFailure('admin:login');
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        const adminPasswordHash = store.getAdminPasswordHash();

        if (!adminPasswordHash) {
          // First-login path: compare against the cleartext .env value
          if (!secureCompareText(password, config.adminPass)) {
            lockout.recordFailure('admin:login');
            sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
            return;
          }
          lockout.recordSuccess('admin:login');
          sendJson(response, 200, { ok: true, reset_required: true });
          return;
        }

        if (!verifyPassword(password, adminPasswordHash)) {
          lockout.recordFailure('admin:login');
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        lockout.recordSuccess('admin:login');
        sendJson(response, 200, { ok: true, total_users: store.getTotalUsers() });
        return;
      }

      // ── POST /api/status ──────────────────────────────────────────────────
      if (url.pathname === '/api/status') {
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return;
        }

        const username = normalizeUsername(payload.username);
        const lockState = lockout.check('auth:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const password = normalizePassword(payload.password);
        const secretCodeword = normalizeSecretCodeword(payload.secretCodeword);
        const alertEmail = normalizeEmail(payload.alertEmail);
        const burnMessage = sanitizeMessage(payload.message);
        const status = payload.status === 'not_ok' ? 0 : 1;
        const timestamp = nowIso();
        const existingUser = store.getUser(username);

        if (existingUser && !verifyPassword(password, existingUser.password_hash)) {
          lockout.recordFailure('auth:' + username);
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        lockout.recordSuccess('auth:' + username);
        const passwordHash = existingUser ? existingUser.password_hash : hashPassword(password);
        const stats = store.saveUserStatus({
          username,
          passwordHash,
          status,
          secretCodeword,
          burnMessage,
          lastStatusUpdate: timestamp,
          alertEmail,
          isNew: !existingUser
        });

        sendJson(response, 200, {
          ok: true,
          private_stats: responseForStats(stats)
        });
        return;
      }

      // ── POST /api/delete-account ──────────────────────────────────────────
      if (url.pathname === '/api/delete-account') {
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return;
        }

        const username = normalizeUsername(payload.username);
        const lockState = lockout.check('auth:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const password = normalizePassword(payload.password);
        const user = store.getUser(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
          lockout.recordFailure('auth:' + username);
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        lockout.recordSuccess('auth:' + username);
        store.deleteUserCompletely(username);
        sendJson(response, 200, { ok: true });
        return;
      }

      // ── POST /api/viewer/access ───────────────────────────────────────────
      if (url.pathname === '/api/viewer/access') {
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return;
        }

        const username = normalizeUsername(payload.username);
        const lockState = lockout.check('viewer:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const codeword = normalizeSecretCodeword(payload.codeword);
        const user = store.getUser(username);

        // Deliberately return the SAME error whether the account does not exist
        // or the codeword is wrong, so the API does not confirm whether a given
        // username is registered.
        if (!user || !secureCompareText(codeword, user.secret_codeword)) {
          lockout.recordFailure('viewer:' + username);
          sendJson(response, 401, { ok: false, error: 'Invalid codeword' });
          return;
        }

        lockout.recordSuccess('viewer:' + username);
        store.updateViewerAccess(username, nowIso());
        sendJson(response, 200, {
          ok: true,
          status: Boolean(user.status),
          last_status_update: user.last_status_update,
          has_message: Boolean(user.burn_message)
        });
        return;
      }

      // ── POST /api/viewer/reveal ───────────────────────────────────────────
      // No Turnstile required: the codeword was already verified by /api/viewer/access
      // in the same browser session; requiring a new Turnstile solve would break UX
      // because the token is single-use and was consumed at the access step.
      if (url.pathname === '/api/viewer/reveal') {
        const username = normalizeUsername(payload.username);
        const lockState = lockout.check('viewer:' + username);
        if (!lockState.allowed) {
          sendTooManyRequests(response, lockState.retryAfterMs);
          return;
        }

        const codeword = normalizeSecretCodeword(payload.codeword);
        const user = store.getUser(username);
        if (!user || !secureCompareText(codeword, user.secret_codeword)) {
          lockout.recordFailure('viewer:' + username);
          sendJson(response, 401, { ok: false, error: 'Invalid codeword' });
          return;
        }

        lockout.recordSuccess('viewer:' + username);
        const message = store.consumeBurnMessage(username);
        sendJson(response, 200, { ok: true, message: message || '' });
        return;
      }

      // ── POST /api/viewer/acknowledge ──────────────────────────────────────
      // No Turnstile required (same rationale as reveal above).
      if (url.pathname === '/api/viewer/acknowledge') {
        const username = normalizeUsername(payload.username);
        const codeword = normalizeSecretCodeword(payload.codeword);
        const user = store.getUser(username);
        if (!user || !secureCompareText(codeword, user.secret_codeword)) {
          sendJson(response, 401, { ok: false, error: 'Invalid codeword' });
          return;
        }

        const alertEmail = store.getAlertEmail(username);
        if (!alertEmail) {
          sendJson(response, 200, { ok: true, mailed: false });
          return;
        }

        const transporter = createMailer(config);
        if (!transporter) {
          // SMTP is not configured; silently treat as success so that
          // the absence or presence of SMTP credentials is not disclosed.
          sendJson(response, 200, { ok: true, mailed: false });
          return;
        }

        await transporter.sendMail({
          from: config.smtpUser,
          to: alertEmail,
          subject: 'pingme.help acknowledgement',
          text: `Your private burn message for ${username} was acknowledged at ${nowIso()}.`
        });
        transporter.close();
        sendJson(response, 200, { ok: true, mailed: true });
        return;
      }

      // ── POST /api/admin/reset ─────────────────────────────────────────────
      if (url.pathname === '/api/admin/reset') {
        const turnstileToken = String(payload.turnstileToken || '');
        if (!(await verifyTurnstile(config, turnstileToken))) {
          sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
          return;
        }

        if (store.getAdminPasswordHash()) {
          sendJson(response, 409, { ok: false, error: 'Admin password already rotated' });
          return;
        }

        const username = String(payload.username || '').trim();
        const password = String(payload.password || '');
        const newPassword = normalizePassword(payload.newPassword);
        if (!secureCompareText(username, config.adminUser) || !secureCompareText(password, config.adminPass)) {
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        store.setAdminPasswordHash(hashPassword(newPassword));
        sendJson(response, 200, { ok: true, total_users: store.getTotalUsers() });
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

      // Generic 500 — no internal details exposed
      sendJson(response, 500, { ok: false, error: 'Server error' });
    }
  });
}

module.exports = {
  createServer
};
