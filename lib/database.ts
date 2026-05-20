// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3-multiple-ciphers');
const { sqlCipherLiteral } = require('./security');

class DatabaseStore {
  constructor(config) {
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    this.db = new Database(config.dbFile);
    this.db.pragma("cipher='sqlcipher'");
    this.db.pragma('legacy=4');
    this.db.pragma(`key='${sqlCipherLiteral(config.dbEncryptionKey)}'`);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.prepare('SELECT count(*) AS table_count FROM sqlite_master').get();
    this.initialize();
    this.prepareStatements();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        twofa_enabled INTEGER NOT NULL DEFAULT 0,
        status INTEGER NOT NULL DEFAULT 1,
        burn_message TEXT,
        last_status_update TEXT NOT NULL,
        last_viewer_access TEXT,
        message_viewed_flag INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codewords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        codeword TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_checked_at TEXT,
        last_burn_viewed_at TEXT,
        UNIQUE(username, codeword),
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS admin_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
      );
    `);

    this.ensureUserColumn('email', 'TEXT');
    this.ensureUserColumn("role", "TEXT NOT NULL DEFAULT 'user'");
    this.ensureUserColumn('twofa_enabled', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureUserColumn('created_at', "TEXT NOT NULL DEFAULT ''");

    this.db.exec("UPDATE users SET created_at = COALESCE(NULLIF(created_at, ''), datetime('now'))");
  }

  ensureUserColumn(name, typeSql) {
    const columns = this.db.prepare('PRAGMA table_info(users)').all();
    if (!columns.some((col) => col.name === name)) {
      this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${typeSql}`);
    }
  }

  prepareStatements() {
    const getBurnMessage = this.db.prepare('SELECT burn_message FROM users WHERE username = ?');
    const clearBurnMessage = this.db.prepare(
      'UPDATE users SET burn_message = NULL, message_viewed_flag = 1 WHERE username = ?'
    );

    this.statements = {
      getUser: this.db.prepare(`
        SELECT username, password_hash, email, role, twofa_enabled, status, burn_message,
               last_status_update, last_viewer_access, message_viewed_flag, created_at
        FROM users
        WHERE username = ?
      `),
      registerUser: this.db.prepare(`
        INSERT INTO users (
          username, password_hash, email, role, twofa_enabled, status,
          burn_message, last_status_update, last_viewer_access, message_viewed_flag, created_at
        ) VALUES (?, ?, ?, ?, 0, 1, NULL, ?, NULL, 0, ?)
      `),
      updateUserCredentials: this.db.prepare(`
        UPDATE users
        SET password_hash = ?, email = ?
        WHERE username = ?
      `),
      updateUserStatus: this.db.prepare(`
        UPDATE users
        SET status = ?, burn_message = ?, last_status_update = ?, message_viewed_flag = 0
        WHERE username = ?
      `),
      setViewerAccess: this.db.prepare(`
        UPDATE users
        SET last_viewer_access = ?
        WHERE username = ?
      `),
      deleteUser: this.db.prepare('DELETE FROM users WHERE username = ?'),
      totalUsers: this.db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'user'"),
      consumeBurnMessage: this.db.transaction((username, viewedAt) => {
        const row = getBurnMessage.get(username);
        clearBurnMessage.run(username);
        this.db.prepare(`
          UPDATE codewords
          SET last_burn_viewed_at = ?
          WHERE username = ? AND codeword = ?
        `).run(viewedAt, username, this._lastRevealCodeword || '');
        return row ? row.burn_message : null;
      }),
      getCodeword: this.db.prepare(`
        SELECT id, username, codeword, is_active, created_at, last_checked_at, last_burn_viewed_at
        FROM codewords
        WHERE username = ? AND codeword = ?
      `),
      listCodewords: this.db.prepare(`
        SELECT id, codeword, is_active, created_at, last_checked_at, last_burn_viewed_at
        FROM codewords
        WHERE username = ?
        ORDER BY id DESC
      `),
      createCodeword: this.db.prepare(`
        INSERT INTO codewords (username, codeword, is_active, created_at, last_checked_at, last_burn_viewed_at)
        VALUES (?, ?, 1, ?, NULL, NULL)
      `),
      setCodewordActive: this.db.prepare(`
        UPDATE codewords
        SET is_active = ?
        WHERE username = ? AND id = ?
      `),
      setCodewordChecked: this.db.prepare(`
        UPDATE codewords
        SET last_checked_at = ?
        WHERE username = ? AND codeword = ?
      `),
      getAdminPasswordHash: this.db.prepare(`
        SELECT setting_value
        FROM admin_settings
        WHERE setting_key = 'admin_password_hash'
      `),
      setAdminPasswordHash: this.db.prepare(`
        INSERT INTO admin_settings (setting_key, setting_value)
        VALUES ('admin_password_hash', ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
      `),
      saveSmtpSetting: this.db.prepare(`
        INSERT INTO admin_settings (setting_key, setting_value)
        VALUES (?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
      `),
      getSetting: this.db.prepare(`
        SELECT setting_value
        FROM admin_settings
        WHERE setting_key = ?
      `),
      getSmtpSettings: this.db.prepare(`
        SELECT setting_key, setting_value
        FROM admin_settings
        WHERE setting_key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_starttls')
      `),
      setUserTwofa: this.db.prepare('UPDATE users SET twofa_enabled = ?, email = ? WHERE username = ?'),
      updatePassword: this.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
    };
  }

  getUser(username) {
    return this.statements.getUser.get(username) || null;
  }

  registerUser({ username, passwordHash, email, role = 'user', createdAt }) {
    this.statements.registerUser.run(username, passwordHash, email, role, createdAt, createdAt);
  }

  saveUserStatus({ username, status, burnMessage, lastStatusUpdate }) {
    this.statements.updateUserStatus.run(status, burnMessage, lastStatusUpdate, username);
    return this.getPrivateStats(username);
  }

  getPrivateStats(username) {
    const user = this.getUser(username);
    if (!user) {
      return null;
    }
    return {
      last_viewer_access: user.last_viewer_access,
      message_viewed_flag: user.message_viewed_flag
    };
  }

  deleteUserCompletely(username) {
    return this.statements.deleteUser.run(username).changes;
  }

  updateViewerAccess(username, timestamp, codeword) {
    this.statements.setViewerAccess.run(timestamp, username);
    this.statements.setCodewordChecked.run(timestamp, username, codeword);
  }

  consumeBurnMessage(username, codeword, viewedAt) {
    this._lastRevealCodeword = codeword;
    const message = this.statements.consumeBurnMessage(username, viewedAt);
    this._lastRevealCodeword = null;
    return message;
  }

  getAdminPasswordHash() {
    const row = this.statements.getAdminPasswordHash.get();
    return row ? row.setting_value : null;
  }

  setAdminPasswordHash(hash) {
    this.statements.setAdminPasswordHash.run(hash);
  }

  getTotalUsers() {
    return this.statements.totalUsers.get().total;
  }

  getCodeword(username, codeword) {
    return this.statements.getCodeword.get(username, codeword) || null;
  }

  listCodewords(username) {
    return this.statements.listCodewords.all(username);
  }

  createCodeword(username, codeword, createdAt) {
    this.statements.createCodeword.run(username, codeword, createdAt);
  }

  setCodewordActive(username, id, active) {
    return this.statements.setCodewordActive.run(active ? 1 : 0, username, id).changes;
  }

  getSmtpSettings(defaults) {
    const rows = this.statements.getSmtpSettings.all();
    const map = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
    return {
      host: map.smtp_host || defaults.smtpHost || '',
      port: Number.parseInt(map.smtp_port || String(defaults.smtpPort || 587), 10),
      user: map.smtp_user || defaults.smtpUser || '',
      pass: map.smtp_pass || defaults.smtpPass || '',
      starttls: (map.smtp_starttls || String(defaults.smtpStartTls)).toLowerCase() === 'true'
    };
  }

  saveSmtpSettings(settings) {
    this.statements.saveSmtpSetting.run('smtp_host', settings.host || '');
    this.statements.saveSmtpSetting.run('smtp_port', String(settings.port || 587));
    this.statements.saveSmtpSetting.run('smtp_user', settings.user || '');
    this.statements.saveSmtpSetting.run('smtp_pass', settings.pass || '');
    this.statements.saveSmtpSetting.run('smtp_starttls', settings.starttls ? 'true' : 'false');
  }

  getSetting(key, fallback = null) {
    const row = this.statements.getSetting.get(key);
    return row ? row.setting_value : fallback;
  }

  setSetting(key, value) {
    this.statements.saveSmtpSetting.run(key, String(value));
  }

  setUserTwofa(username, enabled, email) {
    this.statements.setUserTwofa.run(enabled ? 1 : 0, email || null, username);
  }

  updatePassword(username, passwordHash) {
    this.statements.updatePassword.run(passwordHash, username);
  }

  close() {
    this.db.close();
  }
}

module.exports = {
  DatabaseStore
};
