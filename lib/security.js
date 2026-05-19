const crypto = require('node:crypto');

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeText(value, maxLength) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeMessage(value) {
  const cleaned = sanitizeText(value, 100);
  return cleaned ? cleaned : null;
}

function normalizeUsername(value) {
  const username = sanitizeText(value, 32).toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('invalid username');
  }
  return username;
}

function normalizePassword(value) {
  const password = String(value || '').normalize('NFKC');
  if (password.length < 8 || password.length > 128) {
    throw new Error('invalid password');
  }
  return password;
}

function normalizeSecretCodeword(value) {
  const codeword = sanitizeText(value, 64);
  if (codeword.length < 4) {
    throw new Error('invalid secret');
  }
  return codeword;
}

function normalizeEmail(value) {
  const email = sanitizeText(value, 254).toLowerCase();
  if (!email) {
    return null;
  }
  if (!SIMPLE_EMAIL_PATTERN.test(email)) {
    throw new Error('invalid email');
  }
  return email;
}

function digestText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function secureCompareText(left, right) {
  return crypto.timingSafeEqual(digestText(left), digestText(right));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 3) {
    return false;
  }

  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return secureCompareText(derived, expectedHex);
}

class SlidingWindowRateLimiter {
  constructor() {
    this.windows = new Map();
  }

  hit(key, limit, windowMs) {
    const now = Date.now();
    const timestamps = this.windows.get(key) || [];
    const active = timestamps.filter((value) => now - value < windowMs);

    if (active.length >= limit) {
      this.windows.set(key, active);
      return false;
    }

    active.push(now);
    this.windows.set(key, active);
    return true;
  }
}

function stripIpHeaders(headers) {
  for (const key of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'forwarded']) {
    if (Object.hasOwn(headers, key)) {
      delete headers[key];
    }
  }
}

function sqlCipherLiteral(value) {
  return String(value).replaceAll("'", "''");
}

module.exports = {
  SlidingWindowRateLimiter,
  escapeHtml,
  hashPassword,
  normalizeEmail,
  normalizePassword,
  normalizeSecretCodeword,
  normalizeUsername,
  nowIso,
  sanitizeMessage,
  secureCompareText,
  sqlCipherLiteral,
  stripIpHeaders,
  verifyPassword
};
