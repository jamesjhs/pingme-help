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

function secureCompareText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  const size = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(paddedLeft, paddedRight);
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

const BACKOFF_BASE_MS = 30_000; // 30 seconds for first lockout
const BACKOFF_MAX_MS = 30 * 60 * 1000; // cap at 30 minutes
const FAILURES_BEFORE_LOCKOUT = 3;

/**
 * Exponential-backoff credential lockout.
 *
 * After FAILURES_BEFORE_LOCKOUT (3) consecutive failures for a key the caller
 * is locked out.  Each successive lockout doubles the grace period:
 *   strike 1 → 30 s, strike 2 → 60 s, strike 3 → 120 s … max 30 min.
 *
 * A successful credential check resets all state for the key.
 */
class BackoffLockout {
  constructor() {
    // key → { failCount: number, strikeCount: number, lockUntil: number }
    this._state = new Map();
  }

  /**
   * Check whether the key is currently locked out.
   * Call BEFORE processing credentials.
   * @returns {{ allowed: true } | { allowed: false, retryAfterMs: number }}
   */
  check(key) {
    const entry = this._state.get(key);
    if (!entry || !entry.lockUntil) {
      return { allowed: true };
    }
    const remaining = entry.lockUntil - Date.now();
    if (remaining > 0) {
      return { allowed: false, retryAfterMs: remaining };
    }
    return { allowed: true };
  }

  /**
   * Record a failed credential check.
   * Call AFTER a credential check fails.
   * @returns {{ locked: false } | { locked: true, retryAfterMs: number }}
   */
  recordFailure(key) {
    const now = Date.now();
    const existing = this._state.get(key);
    const entry = existing
      ? { failCount: existing.failCount, strikeCount: existing.strikeCount, lockUntil: existing.lockUntil }
      : { failCount: 0, strikeCount: 0, lockUntil: 0 };

    // If a previous lock has expired, start a fresh attempt window
    if (entry.lockUntil && now >= entry.lockUntil) {
      entry.failCount = 0;
      entry.lockUntil = 0;
    }

    entry.failCount += 1;

    if (entry.failCount >= FAILURES_BEFORE_LOCKOUT) {
      entry.strikeCount += 1;
      const backoffMs = Math.min(
        BACKOFF_BASE_MS * Math.pow(2, entry.strikeCount - 1),
        BACKOFF_MAX_MS
      );
      entry.lockUntil = now + backoffMs;
      entry.failCount = 0;
      this._state.set(key, entry);
      return { locked: true, retryAfterMs: backoffMs };
    }

    this._state.set(key, entry);
    return { locked: false };
  }

  /**
   * Record a successful credential check. Clears all state for the key.
   */
  recordSuccess(key) {
    this._state.delete(key);
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
  sqlCipherLiteral,
  stripIpHeaders,
  verifyPassword
};
