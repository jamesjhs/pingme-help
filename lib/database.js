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
        status INTEGER NOT NULL DEFAULT 1,
        secret_codeword TEXT NOT NULL,
        burn_message TEXT,
        last_status_update TEXT NOT NULL,
        last_viewer_access TEXT,
        message_viewed_flag INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS admin_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_alerts (
        username TEXT PRIMARY KEY,
        alert_email TEXT NOT NULL,
        FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
      );
    `);
  }

  prepareStatements() {
    this.statements = {
      getUser: this.db.prepare(`
        SELECT username, password_hash, status, secret_codeword, burn_message,
               last_status_update, last_viewer_access, message_viewed_flag
        FROM users
        WHERE username = ?
      `),
      getPrivateStats: this.db.prepare(`
        SELECT last_viewer_access, message_viewed_flag
        FROM users
        WHERE username = ?
      `),
      insertUser: this.db.prepare(`
        INSERT INTO users (
          username, password_hash, status, secret_codeword, burn_message,
          last_status_update, last_viewer_access, message_viewed_flag
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
      `),
      updateUser: this.db.prepare(`
        UPDATE users
        SET password_hash = ?, status = ?, secret_codeword = ?, burn_message = ?,
            last_status_update = ?, message_viewed_flag = 0
        WHERE username = ?
      `),
      deleteUser: this.db.prepare('DELETE FROM users WHERE username = ?'),
      deleteAlert: this.db.prepare('DELETE FROM user_alerts WHERE username = ?'),
      upsertAlert: this.db.prepare(`
        INSERT INTO user_alerts (username, alert_email)
        VALUES (?, ?)
        ON CONFLICT(username) DO UPDATE SET alert_email = excluded.alert_email
      `),
      setViewerAccess: this.db.prepare(`
        UPDATE users
        SET last_viewer_access = ?
        WHERE username = ?
      `),
      consumeBurnMessage: this.db.transaction((username) => {
        const row = this.db.prepare('SELECT burn_message FROM users WHERE username = ?').get(username);
        this.db.prepare(`
          UPDATE users
          SET burn_message = NULL,
              message_viewed_flag = 1
          WHERE username = ?
        `).run(username);
        return row ? row.burn_message : null;
      }),
      getAlertEmail: this.db.prepare('SELECT alert_email FROM user_alerts WHERE username = ?'),
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
      totalUsers: this.db.prepare('SELECT COUNT(*) AS total FROM users')
    };
  }

  getUser(username) {
    return this.statements.getUser.get(username) || null;
  }

  getPrivateStats(username) {
    return this.statements.getPrivateStats.get(username) || null;
  }

  saveUserStatus({ username, passwordHash, status, secretCodeword, burnMessage, lastStatusUpdate, alertEmail, isNew }) {
    const run = this.db.transaction((payload) => {
      if (payload.isNew) {
        this.statements.insertUser.run(
          payload.username,
          payload.passwordHash,
          payload.status,
          payload.secretCodeword,
          payload.burnMessage,
          payload.lastStatusUpdate
        );
      } else {
        this.statements.updateUser.run(
          payload.passwordHash,
          payload.status,
          payload.secretCodeword,
          payload.burnMessage,
          payload.lastStatusUpdate,
          payload.username
        );
      }

      if (payload.alertEmail) {
        this.statements.upsertAlert.run(payload.username, payload.alertEmail);
      } else {
        this.statements.deleteAlert.run(payload.username);
      }

      return this.getPrivateStats(payload.username);
    });

    return run({ username, passwordHash, status, secretCodeword, burnMessage, lastStatusUpdate, alertEmail, isNew });
  }

  deleteUserCompletely(username) {
    const run = this.db.transaction((value) => {
      this.statements.deleteAlert.run(value);
      return this.statements.deleteUser.run(value).changes;
    });

    return run(username);
  }

  updateViewerAccess(username, timestamp) {
    this.statements.setViewerAccess.run(timestamp, username);
  }

  consumeBurnMessage(username) {
    return this.statements.consumeBurnMessage(username);
  }

  getAlertEmail(username) {
    const row = this.statements.getAlertEmail.get(username);
    return row ? row.alert_email : null;
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

  close() {
    this.db.close();
  }
}

module.exports = {
  DatabaseStore
};
