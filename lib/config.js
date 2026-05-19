const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const APP_VERSION = 'v0.0.1';
const SERVICE_NAME = 'pingme.help';
const ROOT_DIR = path.resolve(__dirname, '..');

function readRequired(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error('missing env');
  }
  return value;
}

function readOptional(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value).trim().toLowerCase() === 'true';
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadConfig() {
  return {
    rootDir: ROOT_DIR,
    version: APP_VERSION,
    serviceName: SERVICE_NAME,
    port: parsePort(process.env.PORT, 9999),
    dbFile: path.join(ROOT_DIR, 'data', 'pingme-help.sqlite'),
    dbEncryptionKey: readRequired('DB_ENCRYPTION_KEY'),
    turnstileSiteKey: readOptional('TURNSTILE_SITE_KEY'),
    turnstileSecretKey: readOptional('TURNSTILE_SECRET_KEY'),
    adminUser: readOptional('ADMIN_USER', 'admin'),
    adminPass: readRequired('ADMIN_PASS'),
    smtpHost: readOptional('SMTP_HOST'),
    smtpPort: parsePort(process.env.SMTP_PORT, 587),
    smtpUser: readOptional('SMTP_USER'),
    smtpPass: readOptional('SMTP_PASS'),
    smtpStartTls: parseBoolean(process.env.SMTP_STARTTLS, true)
  };
}

module.exports = {
  APP_VERSION,
  SERVICE_NAME,
  loadConfig
};
