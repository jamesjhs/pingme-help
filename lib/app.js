const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');
const nodemailer = require('nodemailer');
const {
  SlidingWindowRateLimiter,
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
  if (!config.turnstileSecretKey || !token) {
    return false;
  }

  try {
    const form = new URLSearchParams({
      secret: config.turnstileSecretKey,
      response: token
    });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
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
  const limiter = new SlidingWindowRateLimiter();

  return http.createServer(async (request, response) => {
    stripIpHeaders(request.headers);
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    try {
      if (request.method === 'GET' && url.pathname === '/readyz') {
        sendJson(response, 200, {
          ok: true,
          service: config.serviceName,
          version: config.version,
          timestamp: nowIso()
        });
        return;
      }

      if (request.method === 'GET' && ASSETS[url.pathname]) {
        sendAsset(response, ASSETS[url.pathname]);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/') {
        sendHtml(response, 200, renderHomePage(config.turnstileSiteKey));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/privacy') {
        sendHtml(response, 200, renderPrivacyPage(config.turnstileSiteKey));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/admin') {
        sendHtml(response, 200, renderAdminPage(config.turnstileSiteKey));
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/u/')) {
        let username;
        try {
          username = normalizeUsername(decodeURIComponent(url.pathname.slice(3)));
        } catch {
          notFound(response);
          return;
        }
        if (!store.getUser(username)) {
          notFound(response);
          return;
        }
        sendHtml(response, 200, renderViewerPage(config.turnstileSiteKey, username));
        return;
      }

      if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) {
        notFound(response);
        return;
      }

      const payload = await getRequestBody(request);

      if (url.pathname === '/api/admin/login') {
        const username = String(payload.username || '').trim();
        const password = String(payload.password || '');

        if (!limiter.hit(`admin:${username}`, 8, 10 * 60 * 1000)) {
          sendJson(response, 429, { ok: false, error: 'Too many attempts' });
          return;
        }

        if (!secureCompareText(username, config.adminUser)) {
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        const adminPasswordHash = store.getAdminPasswordHash();
        if (!adminPasswordHash) {
          if (!secureCompareText(password, config.adminPass)) {
            sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
            return;
          }

          sendJson(response, 200, { ok: true, reset_required: true });
          return;
        }

        if (!verifyPassword(password, adminPasswordHash)) {
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        sendJson(response, 200, { ok: true, total_users: store.getTotalUsers() });
        return;
      }

      const turnstileToken = String(payload.turnstileToken || '');
      if (!(await verifyTurnstile(config, turnstileToken))) {
        sendJson(response, 400, { ok: false, error: 'Turnstile verification failed' });
        return;
      }

      if (url.pathname === '/api/status') {
        const username = normalizeUsername(payload.username);
        if (!limiter.hit(`status:${username}`, 12, 10 * 60 * 1000)) {
          sendJson(response, 429, { ok: false, error: 'Too many attempts' });
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
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

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

      if (url.pathname === '/api/delete-account') {
        const username = normalizeUsername(payload.username);
        if (!limiter.hit(`delete:${username}`, 8, 10 * 60 * 1000)) {
          sendJson(response, 429, { ok: false, error: 'Too many attempts' });
          return;
        }

        const password = normalizePassword(payload.password);
        const user = store.getUser(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
          sendJson(response, 401, { ok: false, error: 'Invalid credentials' });
          return;
        }

        store.deleteUserCompletely(username);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/viewer/access') {
        const username = normalizeUsername(payload.username);
        if (!limiter.hit(`viewer:${username}`, 20, 10 * 60 * 1000)) {
          sendJson(response, 429, { ok: false, error: 'Too many attempts' });
          return;
        }

        const codeword = normalizeSecretCodeword(payload.codeword);
        const user = store.getUser(username);
        if (!user || !secureCompareText(codeword, user.secret_codeword)) {
          sendJson(response, 401, { ok: false, error: 'Invalid codeword' });
          return;
        }

        store.updateViewerAccess(username, nowIso());
        sendJson(response, 200, {
          ok: true,
          status: Boolean(user.status),
          last_status_update: user.last_status_update,
          has_message: Boolean(user.burn_message)
        });
        return;
      }

      if (url.pathname === '/api/viewer/reveal') {
        const username = normalizeUsername(payload.username);
        const codeword = normalizeSecretCodeword(payload.codeword);
        const user = store.getUser(username);
        if (!user || !secureCompareText(codeword, user.secret_codeword)) {
          sendJson(response, 401, { ok: false, error: 'Invalid codeword' });
          return;
        }

        const message = store.consumeBurnMessage(username);
        sendJson(response, 200, { ok: true, message: message || '' });
        return;
      }

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
          sendJson(response, 503, { ok: false, error: 'SMTP not configured' });
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

      if (url.pathname === '/api/admin/reset') {
        const username = String(payload.username || '').trim();
        const password = String(payload.password || '');
        const newPassword = normalizePassword(payload.newPassword);
        if (store.getAdminPasswordHash()) {
          sendJson(response, 409, { ok: false, error: 'Admin password already rotated' });
          return;
        }

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

      sendJson(response, 500, { ok: false, error: 'Server error' });
    }
  });
}

module.exports = {
  createServer
};
