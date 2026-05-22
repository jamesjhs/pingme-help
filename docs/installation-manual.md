# Installation Manual

## 1. Purpose

This guide covers local setup, production preparation, deployment, and troubleshooting for `pingme-help` `v0.5.0`.

## 2. System requirements

- Node.js `>=24.0.0`
- npm
- Linux host recommended for PM2 and NGINX deployment
- Build tooling required by native Node modules when prebuilt binaries are unavailable
- Outbound SMTP access if email workflows are needed
- HTTPS/TLS termination for production

## 3. Prepare the host

1. Install Node.js 24 or newer.
2. Ensure the host can compile native modules if needed.
3. Create a working directory for the app and persistent storage.
4. Decide how TLS will be terminated before internet exposure.

## 4. Install dependencies

From the repository root:

```bash
npm install
```

For reproducible production installs, prefer:

```bash
npm ci
```

## 5. Configure the environment

Copy the template:

```bash
cp .env.example .env
```

Set these values before first startup:

| Variable | Guidance |
|---|---|
| `DB_ENCRYPTION_KEY` | Use a long, unique, high-entropy secret. Losing it makes the database unreadable. |
| `ADMIN_PASS` | Set an initial admin password before deployment. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Strongly recommended in production for public-form bot protection. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Required for registration verification, invites, 2FA emails, and password reset emails. |
| `SMTP_FROM` | Optional sender override for outbound mail. |
| `SMTP_STARTTLS` | Keep `true` unless your SMTP provider explicitly requires otherwise. |

## 6. Validate the installation

Run the repository checks:

```bash
npm test
npm run audit
```

Expected results:

- Tests build the TypeScript source and execute integration coverage for readiness, registration, login, PWA assets, password reset, and error logging.
- Audit checks production dependencies only.

## 7. Run locally

```bash
npm start
```

Default bind port:

- `http://127.0.0.1:9999` unless `PORT` is set

## 8. Production deployment

### PM2

```bash
npm ci
pm2 start ecosystem.config.cjs --env production
pm2 save
```

### NGINX

1. Copy `deploy/nginx/pingme.help.conf` into `/etc/nginx/sites-available/`.
2. Symlink it into `/etc/nginx/sites-enabled/`.
3. Test and reload NGINX:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```
4. Add TLS before public exposure.

## 9. Post-install verification checklist

- Homepage loads with tabs for Send a Ping, Register/Login, and Check a Ping.
- `GET /readyz` returns `ok: true` and `version: v0.5.0`.
- In Send a Ping, selecting “I’m Not OK” reveals an optional prompt to share the request IP as the one-read burn message (best-effort; VPN/firewall/proxy layers may change observed IP).
- Turnstile challenge renders when keys are configured.
- Registration emails send successfully when SMTP is configured.
- PWA manifest and service worker are reachable.

## 10. Backup and maintenance

- Primary data file: `data/pingme-help.sqlite`
- When SQLite WAL mode is active, include matching `-wal` and `-shm` files in backups.
- Keep `package-lock.json` committed and use `npm ci` in controlled environments.
- Re-run `npm test` and `npm run audit` before releases.

## 11. Troubleshooting

### Node version warnings

If npm warns that the current Node version is unsupported, install Node 24 or newer and reinstall dependencies.

### Missing type definitions during build

Run `npm install` to restore dependencies before `npm test` or `npm run build`.

### Database boot failure

Check that:

- `DB_ENCRYPTION_KEY` is set
- The configured key matches the existing encrypted database
- The process can read and write the database directory

### Turnstile does not gate forms

If `TURNSTILE_SECRET_KEY` is blank, the server bypasses Turnstile verification. Configure both site and secret keys for production.

### Email features do not work

Verify SMTP host, port, credentials, and STARTTLS settings. Registration verification, invites, 2FA, and password reset all depend on successful outbound email.

## 12. Amending admin credentials via the CLI

### Changing the admin password

The admin password is read from the `ADMIN_PASS` environment variable on every startup. To change it:

1. Stop the service.
2. Edit `.env` and set a new value for `ADMIN_PASS`:
   ```bash
   # open .env in your editor, then change:
   ADMIN_PASS=your_new_strong_password
   ```
3. Restart the service:
   ```bash
   pm2 restart ecosystem.config.cjs   # PM2
   # or
   npm start                           # local
   ```

> **Note:** If a hashed password has previously been stored directly in the database (key `admin_password_hash` in the `admin_settings` table), it takes precedence over `ADMIN_PASS`. To force the environment variable to be used again, remove that row from the database before restarting:
> ```bash
> node -e "
> const { DatabaseStore } = require('./dist/lib/database');
> require('dotenv').config();
> const store = new DatabaseStore(
>   require('path').join(__dirname, 'data', 'pingme-help.sqlite'),
>   process.env.DB_ENCRYPTION_KEY
> );
> store.db.prepare(\"DELETE FROM admin_settings WHERE setting_key = 'admin_password_hash'\").run();
> console.log('admin_password_hash cleared');
> store.db.close();
> "
> ```

### Changing the admin 2FA email address

The admin 2FA email address is persisted in the encrypted database under the `admin_twofa_email` key. It can be updated without restarting the service using the Node.js REPL or a one-liner:

1. Build the project (if not already built):
   ```bash
   npm run build
   ```
2. Run the following command, replacing `admin@example.com` with the new address:
   ```bash
   node -e "
   const { DatabaseStore } = require('./dist/lib/database');
   require('dotenv').config();
   const store = new DatabaseStore(
     require('path').join(__dirname, 'data', 'pingme-help.sqlite'),
     process.env.DB_ENCRYPTION_KEY
   );
   store.setSetting('admin_twofa_email', 'admin@example.com');
   console.log('admin_twofa_email updated');
   store.db.close();
   "
   ```

The change takes effect immediately for the next login attempt; no service restart is required.
