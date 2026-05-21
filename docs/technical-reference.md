# Technical Reference

## 1. Application summary

`pingme-help` is a privacy-first Node.js service for personal safety check-ins. It uses a server-rendered shell, client-side SPA behaviour, encrypted SQLite storage, and optional Cloudflare Turnstile verification for public actions.

## 2. Runtime architecture

| Layer | Files | Responsibility |
|---|---|---|
| Bootstrap | `server.ts` | Starts the HTTP server and handles fatal process errors |
| Configuration | `lib/config.ts` | Loads environment variables and exports `v0.3.0` |
| Security helpers | `lib/security.ts` | Input normalisation, password hashing, comparisons, lockout logic, and HTML escaping |
| Persistence | `lib/database.ts` | SQLCipher-backed SQLite storage and prepared statements |
| HTTP app | `lib/app.ts` | Routes, sessions, Turnstile verification, SMTP mail flows, and JSON APIs |
| HTML rendering | `lib/pages.ts` | Homepage, privacy page, and shared layout/footer |
| Browser client | `public/app.ts` | Tabs, form submissions, session refresh, PWA install, and dashboard rendering |
| Styling | `public/styles.css` | Dark-first theme and component styling |

## 3. User roles and flows

### Public visitor

- Can request username suggestions
- Can register
- Can start login
- Can send a ping
- Can check a ping with username + codeword

### User

- Can submit quick status updates
- Can manage codewords
- Can configure email 2FA
- Can resend verification emails
- Can change password
- Can invite others
- Can generate share links
- Can delete their own account

### Admin

- Can log in with admin credentials
- Can enable admin 2FA
- Can manage SMTP settings
- Can send invites
- Can see total registered users

### Pinger

- Can view a user's latest status
- Can reveal a burn message once
- Can share the site link and log out

## 4. HTTP endpoints

### Public GET routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | Homepage shell |
| `GET` | `/privacy` | Privacy policy page |
| `GET` | `/verify-email` | Email verification landing page |
| `GET` | `/readyz` | Health/readiness metadata |
| `GET` | `/manifest.webmanifest` | PWA manifest |
| `GET` | `/sw.js` | Service worker |
| `GET` | `/assets/*` | Static assets |

### Public POST routes

| Path | Purpose |
|---|---|
| `/api/turnstile/session` | Exchanges a Turnstile token for a short-lived public-action session |
| `/api/register/suggest` | Suggests a generated username |
| `/api/register` | Creates a user account and signs the user in |
| `/api/send-ping` | Authenticated status update using email/password |
| `/api/login/start` | Starts admin or user login |
| `/api/login/verify-2fa` | Completes email 2FA login |
| `/api/password-reset/request` | Starts password reset by email |
| `/api/password-reset/confirm` | Confirms password reset with emailed code |
| `/api/check-ping` | Authenticates a pinger via username + codeword |

### Authenticated POST routes

| Path | Scope |
|---|---|
| `/api/user/status` | user |
| `/api/pinger/reveal` | pinger |
| `/api/logout` | any session |
| `/api/user/codewords/create` | user |
| `/api/user/codewords/suggest` | user |
| `/api/user/codewords/disable` | user |
| `/api/user/twofa` | user |
| `/api/user/email-verification/resend` | user |
| `/api/user/password` | user |
| `/api/admin/twofa` | admin |
| `/api/admin/smtp` | admin |
| `/api/invite` | authenticated session |
| `/api/user/delete-account` | user |
| `/api/session/refresh` | any session |

## 5. Security model

### Controls in place

- SQLCipher-encrypted SQLite database
- `scrypt` password hashing
- Timing-safe credential comparisons
- Request-body size limit
- HTML escaping and input normalisation
- Lockout/backoff on repeated failures
- Hardened response headers and CSP
- IP forwarding header stripping
- Optional Cloudflare Turnstile gating for public actions

### Current operational caveats

- App sessions are in-memory and do not currently expire automatically.
- Lockout state is in-memory and resets on restart.
- If `TURNSTILE_SECRET_KEY` is omitted, public-form bot protection is bypassed.
- Production deployments should add TLS before exposing login or codeword traffic.
- The initial admin password comes from `ADMIN_PASS`.

## 6. Data and email behaviour

- User registration generates a username and initial codeword automatically.
- Registration, password reset, invitations, and verification rely on SMTP when configured.
- `SMTP_FROM` overrides the default sender; otherwise the SMTP auth user is used.
- Burn messages are designed to be consumed once.

## 7. UI reference

### Primary views

- Homepage
- Privacy page
- Email verification result page

### Homepage sections

- Quick status card for signed-in users
- Tabbed public action card
- Marketing/pitch card
- User dashboard
- Admin dashboard
- Pinger dashboard

### Theme and interaction model

- Dark-first palette with compact cards and buttons
- Send/check tabs use red/green tinting to reinforce intent
- Accessible feedback areas use `aria-live="polite"`
- PWA install affordance appears when the browser fires `beforeinstallprompt`
- The browser client hides public tabs and reveals dashboards after session refresh/login

## 8. Environment reference

See `.env.example` for the full template. Key operational values:

- `DB_ENCRYPTION_KEY` protects all stored data
- `ADMIN_PASS` controls first-run admin access
- `TURNSTILE_*` controls human verification
- `SMTP_*` controls email delivery
- `PORT` changes the HTTP listener

## 9. Validation and release

Use:

```bash
npm test
npm run audit
```

Versioned release metadata is surfaced in:

- `package.json`
- `package-lock.json`
- `lib/config.ts`
- `/readyz`
- shared page footer
