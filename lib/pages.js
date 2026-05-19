const { escapeHtml } = require('./security');

// Shared non-autocomplete field attributes applied to every interactive input.
// autocomplete is set per-field below so browsers and password managers
// get accurate hints rather than the overly-broad 'one-time-code' catch-all.
const CA = 'autocapitalize="none" autocorrect="off" spellcheck="false"';

function renderLayout({ title, view, content, turnstileSiteKey = '', extraHead = '' }) {
  const safeTitle = escapeHtml(title);
  const hasTurnstile = Boolean(turnstileSiteKey);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="description" content="Private status updates for the people who matter.">
  <meta name="theme-color" content="#1463ff">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <meta name="turnstile-site-key" content="${escapeHtml(turnstileSiteKey)}">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="/assets/styles.css">
  ${hasTurnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>' : ''}
  <script src="/assets/app.js" defer></script>
  ${extraHead}
</head>
<body data-view="${escapeHtml(view)}">
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/">pingme.help</a>
      <a class="privacy-link" href="/privacy">Privacy Policy</a>
    </header>
    <main class="page">${content}</main>
    <footer class="footer">
      <div>&copy;PingMe.HELP 2026 | v0.0.1</div>
      <a href="/privacy">Privacy Policy</a>
    </footer>
  </div>
</body>
</html>`;
}

function renderHomePage(siteKey) {
  return renderLayout({
    title: 'pingme.help',
    view: 'home',
    turnstileSiteKey: siteKey,
    content: `
      <section class="hero card">
        <p class="eyebrow">Private readiness for the people who matter.</p>
        <h1>Update your status fast, keep your trail small.</h1>
        <p class="lede">Create or update your private status, burn-after-read message, and optional alert email without storing IPs, cookies, or activity logs in the app.</p>
      </section>

      <section class="tabs card" aria-label="Dashboard tabs">
        <div class="tab-row" role="tablist">
          <button class="tab-button is-active" type="button" id="tab-btn-update"
            data-tab-target="update-panel" role="tab" aria-selected="true"
            aria-controls="update-panel">Update Status</button>
          <button class="tab-button" type="button" id="tab-btn-delete"
            data-tab-target="delete-panel" role="tab" aria-selected="false"
            aria-controls="delete-panel">Delete Account</button>
        </div>

        <section id="update-panel" class="tab-panel is-active" role="tabpanel" aria-labelledby="tab-btn-update">
          <form id="status-form" class="stack-form" novalidate>
            <label>
              <span>Username</span>
              <input name="username" type="text" maxlength="32" required
                autocomplete="username" ${CA}>
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" maxlength="128" required
                autocomplete="current-password" ${CA}>
            </label>
            <label>
              <span>Secret Codeword</span>
              <input name="secretCodeword" type="text" maxlength="64" required
                autocomplete="off" ${CA}>
            </label>
            <label>
              <span>Alert Email <small>(optional)</small></span>
              <input name="alertEmail" type="email" maxlength="254" inputmode="email"
                autocomplete="email" ${CA}>
            </label>
            <label>
              <span>Burn Message <small>(optional)</small></span>
              <textarea name="message" id="burn-message-input" maxlength="100" rows="3"
                autocomplete="off" ${CA}></textarea>
              <span class="char-count" id="burn-char-count" aria-live="polite">100 characters remaining</span>
            </label>
            <input type="hidden" name="status" value="ok">
            <div class="status-actions">
              <button class="status-button ok" type="button" data-status-value="ok">I&#39;m OK</button>
              <button class="status-button not-ok" type="button" data-status-value="not_ok">I&#39;m Not OK</button>
            </div>
            <div class="turnstile-shell js-turnstile"></div>
          </form>
          <div id="status-feedback" class="feedback" aria-live="polite"></div>
          <section id="private-stats" class="card inset-card hidden" aria-live="polite">
            <h2>Your private stats</h2>
            <p><strong>Last viewer access:</strong> <span data-stat="lastViewerAccess">Never</span></p>
            <p><strong>Message state:</strong> <span data-stat="messageViewedFlag">Not viewed</span></p>
          </section>
        </section>

        <section id="delete-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-delete" hidden>
          <form id="delete-form" class="stack-form" novalidate>
            <label>
              <span>Username</span>
              <input name="username" type="text" maxlength="32" required
                autocomplete="username" ${CA}>
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" maxlength="128" required
                autocomplete="current-password" ${CA}>
            </label>
            <label class="confirm-label">
              <input type="checkbox" id="delete-confirm-check">
              <span>I understand this is permanent and cannot be undone</span>
            </label>
            <div class="turnstile-shell js-turnstile"></div>
            <button class="destructive-button" id="delete-submit-btn" type="submit" disabled>Delete Account</button>
          </form>
          <div id="delete-feedback" class="feedback" aria-live="polite"></div>
        </section>
      </section>
    `
  });
}

function renderViewerPage(siteKey, username) {
  return renderLayout({
    title: `View ${username} | pingme.help`,
    view: 'viewer',
    turnstileSiteKey: siteKey,
    extraHead: `<meta name="viewer-username" content="${escapeHtml(username)}">`,
    content: `
      <section class="card viewer-card">
        <p class="eyebrow">Follower access</p>
        <h1>Unlock ${escapeHtml(username)}&#39;s status</h1>
        <p class="lede">Enter the shared secret codeword to reveal the current readiness state and optional burn-after-read message.</p>
        <form id="viewer-access-form" class="stack-form" novalidate>
          <label>
            <span>Secret Codeword</span>
            <input name="codeword" type="password" maxlength="64" required
              autocomplete="off" ${CA}>
          </label>
          <div class="turnstile-shell js-turnstile"></div>
          <button class="primary-button" type="submit">Unlock Status</button>
        </form>
        <div id="viewer-feedback" class="feedback" aria-live="polite"></div>
        <section id="viewer-result" class="hidden">
          <div class="status-pill" id="viewer-status-pill"></div>
          <p class="timestamp-copy">Last Updated: <span id="viewer-last-updated"></span></p>
          <button id="reveal-message-button" class="blur-card hidden" type="button">View private message &mdash; deleted from server on open</button>
          <div id="revealed-message" class="card inset-card hidden"></div>
          <button id="acknowledge-button" class="primary-button hidden" type="button">Acknowledge &amp; notify owner</button>
        </section>
      </section>
    `
  });
}

function renderAdminPage(siteKey) {
  return renderLayout({
    title: 'Admin | pingme.help',
    view: 'admin',
    turnstileSiteKey: siteKey,
    content: `
      <section class="card admin-card">
        <p class="eyebrow">Admin</p>
        <h1>Minimal control panel</h1>
        <p class="lede">The admin surface only exposes a single metric after authentication: total registered users.</p>
        <form id="admin-login-form" class="stack-form" novalidate>
          <label>
            <span>Admin Username</span>
            <input name="username" type="text" maxlength="64" required
              autocomplete="username" ${CA}>
          </label>
          <label>
            <span>Admin Password</span>
            <input name="password" type="password" maxlength="128" required
              autocomplete="current-password" ${CA}>
          </label>
          <div class="turnstile-shell js-turnstile"></div>
          <button class="primary-button" type="submit">Sign In</button>
        </form>
        <form id="admin-reset-form" class="stack-form hidden" novalidate>
          <label>
            <span>New Admin Password</span>
            <input name="newPassword" type="password" maxlength="128" required
              autocomplete="new-password" ${CA}>
          </label>
          <div class="turnstile-shell js-turnstile"></div>
          <button class="primary-button" type="submit">Set New Password</button>
        </form>
        <div id="admin-feedback" class="feedback" aria-live="polite"></div>
        <section id="admin-dashboard" class="card inset-card hidden" aria-live="polite">
          <h2>Total registered users</h2>
          <p class="metric" id="total-users">0</p>
        </section>
      </section>
    `
  });
}

function renderPrivacyPage(siteKey) {
  return renderLayout({
    title: 'Privacy Policy | pingme.help',
    view: 'privacy',
    turnstileSiteKey: siteKey,
    content: `
      <article class="card prose-card">
        <p class="eyebrow">Privacy Policy</p>
        <h1>pingme.help Privacy Policy</h1>
        <p>pingme.help is designed to minimise data collection. The service does not store server-side IP addresses, does not create backend activity logs, and does not track users with database cookies. Requests are processed without retaining inbound network identifiers in the application layer.</p>
        <h2>What the service stores</h2>
        <p>The encrypted SQLite database stores only the fields needed to run the service: usernames, password hashes, readiness state, a shared secret codeword, an optional burn-after-read message, simplified &ldquo;Last Updated&rdquo; and &ldquo;Last Accessed&rdquo; text values, whether the burn message was viewed, and an optional alert email if a user chooses to configure one. These values are stored without IP references and without hidden server metadata fields.</p>
        <h2>What the service does not store</h2>
        <p>The server stores absolute zero server-side IP tracking, zero backend activity logs, and zero database cookie tracking. NGINX is configured without access logging for this application, and the Node.js application intentionally strips common IP-forwarding headers before request handling.</p>
        <h2>Displayed activity times</h2>
        <p>The &ldquo;Last Updated&rdquo; and &ldquo;Last Accessed&rdquo; indicators are simplified data values created to inform users and followers when activity occurred. They are stored securely without attached system metadata, IP references, or hidden tracking identifiers.</p>
        <h2>Cryptographic protections</h2>
        <p>The database is encrypted at rest with AES-256 SQLCipher. Application passwords are never stored in reversible form; they are stored as non-reversible salted hashes generated with Node.js cryptography primitives.</p>
        <h2>Layer transparency</h2>
        <p>Cloudflare Turnstile is used to challenge suspected bots before state-changing actions are accepted. NGINX is configured to strip downstream IP forwarding headers before traffic reaches the backend. The Node.js service itself never extracts or uses IP objects from inbound web headers.</p>
        <p>Because pingme.help uses Cloudflare for DDoS protection and domain resolution, network-level transit logs remain subject to Cloudflare&rsquo;s global edge infrastructure privacy rules. Those network-layer logs are outside the application database and outside the Node.js runtime.</p>
        <h2>Email acknowledgements</h2>
        <p>If a user configures an optional alert email, an acknowledgement email can be sent when a private burn message is acknowledged. SMTP credentials are read from the server environment and are not exposed to followers.</p>
      </article>
    `
  });
}

module.exports = {
  renderAdminPage,
  renderHomePage,
  renderPrivacyPage,
  renderViewerPage
};
