# pingme.help

Privacy-first readiness sharing for people who want a lightweight way to check in, share status, and let trusted followers verify that they are safe.

Current application version: `v0.1.0`

## Feature overview

- PWA-ready homepage with install prompt, manifest, and service worker shell caching.
- Public homepage flows for **Send a Ping**, **Register/Login**, and **Check a Ping**.
- Email-first authentication for users, with admin username fallback support.
- Email verification, email-based password reset, and optional email 2FA for users and admins.
- Shared codewords for follower access, including one-read burn messages.
- User dashboard for status updates, codeword management, invites, password changes, and account deletion.
- Admin dashboard for SMTP configuration, invite sending, and admin 2FA.
- Encrypted SQLite storage, hardened headers, Turnstile integration, and request-body/input sanitisation.

## Repository layout

- `.env.example` - environment template
- `server.ts` - process bootstrap and top-level error handling
- `lib/` - configuration, security, database, page rendering, and HTTP server logic
- `public/` - browser TypeScript and site CSS
- `test/` - Node built-in integration tests
- `deploy/nginx/pingme.help.conf` - example reverse-proxy config
- `ecosystem.config.cjs` - PM2 process definition
- `docs/installation-manual.md` - in-depth install and deployment guide
- `docs/technical-reference.md` - architecture, API, security, and UI reference

## Requirements

- Node.js `>=24.0.0`
- npm
- A strong `DB_ENCRYPTION_KEY`
- Optional but recommended production services:
  - Cloudflare Turnstile site and secret keys
  - SMTP server for verification, invite, and reset emails
  - TLS termination in front of the app

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
3. Set required secrets in `.env`.
4. Validate the app:
   ```bash
   npm test
   npm run audit
   ```
5. Start locally:
   ```bash
   npm start
   ```

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `PORT` | No | HTTP port, defaults to `9999` |
| `DB_ENCRYPTION_KEY` | Yes | SQLCipher passphrase for the encrypted SQLite database |
| `TURNSTILE_SITE_KEY` | No | Client-side Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | No | Server-side Turnstile verification secret |
| `ADMIN_USER` | No | Admin username, defaults to `admin` |
| `ADMIN_PASS` | Yes | Initial admin password |
| `SMTP_HOST` | No | SMTP host for outbound email |
| `SMTP_PORT` | No | SMTP port, defaults to `587` |
| `SMTP_USER` | No | SMTP username |
| `SMTP_FROM` | No | Optional sender override; falls back to SMTP auth user when blank |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_STARTTLS` | No | Whether STARTTLS is required, defaults to `true` |

## Validation

```bash
npm test
npm run audit
```

## Documentation

- [Installation Manual](./docs/installation-manual.md)
- [Technical Reference](./docs/technical-reference.md)

## Deployment notes

- PM2 example:
  ```bash
  npm install
  pm2 start ecosystem.config.cjs --env production
  pm2 save
  ```
- NGINX example config is provided in `deploy/nginx/pingme.help.conf`.
- Add TLS separately before exposing the app publicly.

## Security and operations notes

- Public forms rely on a single site-level Turnstile verification session when Turnstile is configured.
- If `TURNSTILE_SECRET_KEY` is left blank, bot protection is bypassed.
- Session state and lockout state are in process memory, so they reset on restart.
- The database is encrypted at rest; losing `DB_ENCRYPTION_KEY` means losing access to the data.
- Email features require working SMTP settings.
- Back up the SQLite database together with any `-wal` and `-shm` files when the service is offline.
