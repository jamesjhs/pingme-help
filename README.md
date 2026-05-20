# pingme.help

Privacy-first readiness sharing service with role-based flows for admin, users, and follower "pingers".

## File structure

- `.env.example` - environment template
- `server.ts` - boot entrypoint with safe startup failure handling
- `lib/` - TypeScript modules for configuration, security, database, username/codeword generation, page rendering, and HTTP app logic
- `public/` - mobile-first CSS and browser TypeScript
- `dist/` - generated JavaScript build output
- `deploy/nginx/pingme.help.conf` - NGINX reverse proxy with access logging disabled
- `ecosystem.config.cjs` - PM2 process definition
- `test/server.test.js` - smoke tests using the built-in Node.js test runner

## Setup

1. Install Node.js 24 on the host.
2. Copy `.env.example` to `.env` and set real secrets.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build and start locally:
   ```bash
   npm run build
   npm start
   ```

## Environment template

```dotenv
PORT=9999
DB_ENCRYPTION_KEY=your_strong_sqlite_passphrase_here
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
ADMIN_USER=admin
ADMIN_PASS=temporary_cleartext_password
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_FROM=
SMTP_PASS=
SMTP_STARTTLS=true
```

## Validation

```bash
npm test
npm run audit
```

## Deployment with PM2

```bash
npm install
pm2 start ecosystem.config.cjs --env production
pm2 save
```

## Deployment with NGINX

1. Copy `deploy/nginx/pingme.help.conf` to `/etc/nginx/sites-available/pingme.help.conf`.
2. Enable the site and reload NGINX:
   ```bash
   sudo ln -s /etc/nginx/sites-available/pingme.help.conf /etc/nginx/sites-enabled/pingme.help.conf
   sudo nginx -t
   sudo systemctl reload nginx
   ```
3. Add TLS separately for production.

## Notes

- `GET /readyz` returns the live readiness payload with the current ISO timestamp.
- Homepage tabs: Send a Ping, Register, Login, and Check a Ping. After a user or admin logs in, the tabs are hidden and the user quick check-in controls move to the top of the page.
- User registration uses auto-generated verb-noun usernames, signs the user in immediately, sends a magic-link email verification, and generates an initial adjective-noun follower codeword.
- User/admin login supports optional email 2FA; user password reset is email-based.
- Admin dashboard exposes total user count and SMTP settings.
- Users can create multiple codewords, disable individual codewords, resend email verification, change their password, invite others, and delete their own accounts.
- Follower access ("Check a Ping") is codeword-gated and burn messages are single-view.
- The backend strips common IP forwarding headers, does not use request logging middleware, and relies on a single site-level Cloudflare Turnstile verification session for non-logged-in forms, with the main public action buttons unlocked only after the human check completes.
- Database boot fails safely when `DB_ENCRYPTION_KEY` is missing or unusable.
