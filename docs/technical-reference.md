# Technical Reference

## 1. Application summary

`pingme-help` is a privacy-first Node.js service for personal safety check-ins. It uses a server-rendered shell, client-side SPA behaviour, encrypted SQLite storage, and optional Cloudflare Turnstile verification for public actions.

## 2. Runtime architecture

| Layer | Files | Responsibility |
|---|---|---|
| Bootstrap | `server.ts` | Starts the HTTP server and handles fatal process errors |
| Configuration | `lib/config.ts` | Loads environment variables and exports `v0.5.0` |
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
- Can optionally share request-observed IP as the burn message on `not_ok` updates
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
| `/api/user/codewords/delete` | user |
| `/api/user/follows/list` | user |
| `/api/user/follows/add` | user |
| `/api/user/follows/remove` | user |
| `/api/user/follows/check` | user |
| `/api/user/twofa` | user |
| `/api/user/email-verification/resend` | user |
| `/api/user/password` | user |
| `/api/admin/password` | admin |
| `/api/admin/twofa` | admin |
| `/api/admin/smtp` | admin |
| `/api/invite` | authenticated session |
| `/api/user/delete-account` | user |
| `/api/session/refresh` | any session |

### Status update payload caveat

- `/api/send-ping` and `/api/user/status` support optional `shareIpAsBurnMessage`.
- It is applied only when the submitted status is `not_ok`.
- The server derives the burn message from best-effort socket IP observation.
- VPN/firewall/proxy layers can alter the visible address; the UI and pinger views call this out explicitly.

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
- IP burn messages are best-effort and can be influenced by VPN/firewall/proxy topology.

### Deep-dive: security, efficiency, abuse, and edge cases

#### User errors and malformed/scripted input

- All public auth-sensitive routes normalize and validate inputs (email, username, password, codeword, burn message).
- Invalid JSON and oversized bodies are rejected with bounded error responses.
- Burn messages are sanitized and length-limited to reduce unsafe/control-character payloads.
- Checkbox-style payloads (`on`) are accepted for `shareIpAsBurnMessage` to avoid accidental client mismatch failures.

#### Brute-force and abuse paths

- Credentialed routes (`/api/login/start`, `/api/send-ping`) use exponential backoff lockout keys.
- Repeated failures quickly reduce guessing throughput while successful auth clears lockout state.
- Turnstile sessions gate public routes when configured, limiting scripted high-rate submission.
- In-memory lockout/session state means process restarts clear state; production should pair this with external rate controls.

#### API endpoint risk posture

- Header-level spoofing vectors are reduced by stripping forwarded IP headers before route processing.
- Security response headers (CSP, COOP/CORP, XFO, no-referrer, nosniff) are applied by default.
- Error payloads avoid stack traces and implementation internals in client responses.
- One-read burn-message semantics reduce replay exposure of sensitive emergency notes.

#### Edge cases and operational caveats

- If a user enables IP burn message on `not_ok`, socket-derived IP is stored when valid.
- If socket IP is unavailable/invalid, the service falls back to sanitized message text instead of hard-failing.
- “Public-facing IP” is informational, not authoritative, and can represent a gateway/VPN/firewall egress.
- Session and lockout maps are memory-bound and cleaned as challenges expire.

#### Efficiency profile

- Prepared statements and constrained payload sizes reduce DB and parser overhead.
- Fast-fail checks (validation, lockout, auth) limit unnecessary downstream work.
- Service worker cache-version pinning evicts stale bundles after version bumps.
- Lightweight JSON responses and one-read message consumption keep endpoint work bounded.

## 6. Data and email behaviour

- User registration generates a username and initial codeword automatically.
- Registration, password reset, invitations, and verification rely on SMTP when configured.
- `SMTP_FROM` overrides the default sender; otherwise the SMTP auth user is used.
- Burn messages are designed to be consumed once.
- “Not OK” updates can optionally replace burn message text with best-effort request IP.

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
- “I’m Not OK” actions expose an IP-share caveat prompt for burn message replacement
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

## 9. CLI admin credential management

### Admin password

The admin password is resolved at login time from `ADMIN_PASS` in `.env`. If an `admin_password_hash` row exists in the `admin_settings` table it takes precedence; otherwise the plaintext `ADMIN_PASS` value is used directly.

To change the password via the CLI:

1. Stop the service.
2. Update `ADMIN_PASS` in `.env`.
3. Restart the service.

If a database-stored hash needs to be cleared first:

```bash
node -e "
const { DatabaseStore } = require('./dist/lib/database');
require('dotenv').config();
const store = new DatabaseStore(
  require('path').join(__dirname, 'data', 'pingme-help.sqlite'),
  process.env.DB_ENCRYPTION_KEY
);
store.db.prepare(\"DELETE FROM admin_settings WHERE setting_key = 'admin_password_hash'\").run();
console.log('admin_password_hash cleared');
store.db.close();
"
```

### Admin 2FA email address

The admin 2FA email address is stored in the `admin_settings` table under the key `admin_twofa_email`. It can be updated without a service restart:

```bash
npm run build   # ensure dist/ is current

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

Replace `admin@example.com` with the desired address. The change is effective immediately for subsequent login attempts.

## 10. Validation and release

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

## 11. Public SEO and product positioning

### Landing-page SEO implementation

- Homepage now includes expanded metadata for search/social discovery:
  - description and keyword meta tags
  - canonical URL
  - Open Graph and Twitter summary tags
  - JSON-LD (`SoftwareApplication`) structured data
- Messaging is written for plain-language search intent around private safety check-ins, trusted-contact status sharing, and emergency context handoff.

### Public-facing and administrator-facing feature framing

- Public-facing messaging highlights:
  - fast status sharing (`ok` / `not_ok`)
  - codeword-gated status checks
  - optional one-read burn messages
  - follow subscriptions for trusted contacts
- Administrator-facing messaging highlights:
  - SMTP delivery controls
  - admin password and admin 2FA management
  - invitation operations and user-count visibility
- Root/system-level controls are intentionally excluded from public-facing copy and UI.

### Competitive compare/contrast (category-level USPs)

- Versus tracking-heavy family safety platforms:
  - PingMe.help emphasizes event-based check-ins rather than continuous location telemetry.
- Versus generic messaging/chat products:
  - PingMe.help provides status-specific workflows, codeword-gated access, and one-read burn-message semantics.
- Versus dead-man-switch-centric tools:
  - PingMe.help supports proactive user-initiated updates and on-demand follower checks.
