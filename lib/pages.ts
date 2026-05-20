// @ts-nocheck
const { escapeHtml } = require('./security');

const CA = 'autocapitalize="none" autocorrect="off" spellcheck="false"';

function renderLayout({ title, view, content, turnstileSiteKey = '' }) {
  const safeTitle = escapeHtml(title);
  const hasTurnstile = Boolean(turnstileSiteKey);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="description" content="Private readiness check-ins for people you trust.">
  <meta name="theme-color" content="#070b12">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <meta name="turnstile-site-key" content="${escapeHtml(turnstileSiteKey)}">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="/assets/styles.css">
  ${hasTurnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>' : ''}
  <script src="/assets/app.js" defer></script>
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
      <section id="quick-status-card" class="card hidden" aria-live="polite">
        <p class="eyebrow">Quick check-in</p>
        <form id="quick-status-form" class="stack-form" novalidate>
          <label>
            <span>Burn Message <small>(optional)</small></span>
            <textarea name="message" id="quick-burn-message-input" maxlength="100" rows="3" autocomplete="off" ${CA}></textarea>
            <span class="char-count" id="quick-burn-char-count" aria-live="polite">100 characters remaining</span>
          </label>
          <input type="hidden" name="status" value="ok">
          <div class="status-actions">
            <button class="status-button ok" type="button" data-quick-status-value="ok">I&#39;m OK</button>
            <button class="status-button not-ok" type="button" data-quick-status-value="not_ok">I&#39;m Not OK</button>
          </div>
        </form>
        <div id="quick-status-feedback" class="feedback" aria-live="polite"></div>
      </section>

      <section id="home-tabs" class="tabs card" aria-label="Homepage tabs">
        <div class="tab-row" role="tablist">
          <button class="tab-button is-active" type="button" id="tab-btn-send" data-tab-target="send-panel" role="tab" aria-selected="true" aria-controls="send-panel">Send a Ping</button>
          <button class="tab-button" type="button" id="tab-btn-register" data-tab-target="register-panel" role="tab" aria-selected="false" aria-controls="register-panel">Register</button>
          <button class="tab-button" type="button" id="tab-btn-login" data-tab-target="login-panel" role="tab" aria-selected="false" aria-controls="login-panel">Login</button>
          <button class="tab-button" type="button" id="tab-btn-check" data-tab-target="check-panel" role="tab" aria-selected="false" aria-controls="check-panel">Check a Ping</button>
        </div>

        <section id="send-panel" class="tab-panel is-active" role="tabpanel" aria-labelledby="tab-btn-send">
          <form id="send-ping-form" class="stack-form" novalidate>
            <label><span>Username</span><input name="username" type="text" maxlength="32" required autocomplete="off" ${CA}></label>
            <label><span>Password</span><input name="password" type="password" maxlength="128" required autocomplete="current-password" ${CA}></label>
            <label>
              <span>Burn Message <small>(optional)</small></span>
              <textarea name="message" id="burn-message-input" maxlength="100" rows="3" autocomplete="off" ${CA}></textarea>
              <span class="char-count" id="burn-char-count" aria-live="polite">100 characters remaining</span>
            </label>
            <input type="hidden" name="status" value="ok">
            <div class="status-actions">
              <button class="status-button ok" type="button" data-status-value="ok" data-public-action>I&#39;m OK</button>
              <button class="status-button not-ok" type="button" data-status-value="not_ok" data-public-action>I&#39;m Not OK</button>
            </div>
          </form>
          <div id="send-ping-feedback" class="feedback" aria-live="polite"></div>
        </section>

        <section id="register-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-register" hidden>
          <form id="register-form" class="stack-form" novalidate>
            <label>
              <span>Generated Username</span>
              <div class="input-action-row">
                <input id="register-username" name="username" type="text" maxlength="32" required autocomplete="off" readonly ${CA}>
                <button id="regenerate-username-button" class="icon-button" type="button" aria-label="Generate another username">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M15.5 5.5A7 7 0 0 0 5.7 8H3l3.3-3.3L9.6 8H7.8a5 5 0 1 1 1 9.9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                    <path d="M8.5 18.5A7 7 0 0 0 18.3 16H21l-3.3 3.3L14.4 16h1.8a5 5 0 1 1-1-9.9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>
                  </svg>
                </button>
              </div>
            </label>
            <label><span>Password</span><input name="password" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
            <label><span>Confirm Password</span><input name="passwordConfirm" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
            <label><span>Email Address</span><input name="email" type="email" maxlength="254" required autocomplete="email" ${CA}></label>
            <button class="primary-button" type="submit" data-public-action>Register</button>
          </form>
          <div id="register-feedback" class="feedback" aria-live="polite"></div>
        </section>

        <section id="login-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-login" hidden>
          <form id="login-form" class="stack-form" novalidate>
            <label><span>Username</span><input name="username" type="text" maxlength="32" required autocomplete="off" ${CA}></label>
            <label><span>Password</span><input name="password" type="password" maxlength="128" required autocomplete="current-password" ${CA}></label>
            <button class="primary-button" type="submit" data-public-action>Login</button>
          </form>
          <form id="login-2fa-form" class="stack-form hidden" novalidate>
            <label><span>Secret Code</span><input name="code" type="text" maxlength="6" required autocomplete="one-time-code" ${CA}></label>
            <input name="challengeId" type="hidden" value="">
            <button class="primary-button" type="submit" data-public-action>Verify 2FA</button>
          </form>
          <form id="password-reset-request-form" class="stack-form" novalidate>
            <label><span>Forgot password? Email address</span><input name="email" type="email" maxlength="254" required autocomplete="email" ${CA}></label>
            <button class="primary-button" type="submit" data-public-action>Send Reset Email</button>
          </form>
          <form id="password-reset-confirm-form" class="stack-form hidden" novalidate>
            <input name="challengeId" type="hidden" value="">
            <label><span>Reset Code</span><input name="code" type="text" maxlength="6" required autocomplete="one-time-code" ${CA}></label>
            <label><span>New Password</span><input name="newPassword" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
            <button class="primary-button" type="submit" data-public-action>Reset Password</button>
          </form>
          <div id="login-feedback" class="feedback" aria-live="polite"></div>
        </section>

        <section id="check-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-check" hidden>
          <form id="check-ping-form" class="stack-form" novalidate>
            <label><span>Username</span><input name="username" type="text" maxlength="32" required autocomplete="off" ${CA}></label>
            <label><span>Shared Codeword</span><input name="codeword" type="password" maxlength="64" required autocomplete="off" ${CA}></label>
            <button class="primary-button" type="submit" data-public-action>Check Status</button>
          </form>
          <div id="check-ping-feedback" class="feedback" aria-live="polite"></div>
          <section id="pinger-dashboard" class="card inset-card hidden" aria-live="polite">
            <h2>Pinger Dashboard</h2>
            <p><strong>User:</strong> <span data-pinger="username"></span></p>
            <div class="status-pill" data-pinger="status"></div>
            <p><strong>Last Updated:</strong> <span data-pinger="lastUpdated"></span></p>
            <button id="pinger-reveal-message" class="blur-card hidden" type="button">View burn message (single view)</button>
            <div id="pinger-message" class="card inset-card hidden"></div>
            <div class="status-actions">
              <button id="pinger-share-site" class="primary-button" type="button">Share PingMe</button>
              <button id="pinger-logout" class="destructive-button" type="button">Logout</button>
            </div>
          </section>
        </section>
      </section>

      <section id="user-dashboard" class="card hidden" aria-live="polite">
        <p class="eyebrow">User Dashboard</p>
        <h2>Manage your check-ins and followers</h2>
        <p><strong>Logged in as:</strong> <span data-user="username"></span></p>
        <p>
          <strong>Email:</strong>
          <span data-user="email">—</span>
          <span data-user="emailVerificationStatus" class="verification-status">unverified</span>
        </p>
        <p><strong>Last checked by:</strong> <span data-user="lastViewerAccess">Never</span></p>
        <p><strong>Message viewed:</strong> <span data-user="messageViewed">Not viewed</span></p>

        <form id="user-twofa-form" class="stack-form" novalidate>
          <label><span>2FA Email</span><input name="email" type="email" maxlength="254" autocomplete="email" ${CA}></label>
          <label class="confirm-label"><input type="checkbox" name="enabled"><span>Enable email 2FA for login</span></label>
          <button class="primary-button" type="submit">Save 2FA Settings</button>
        </form>

        <button id="user-resend-verification" class="primary-button" type="button">Resend Verification Email</button>

        <form id="user-password-form" class="stack-form" novalidate>
          <label><span>Current Password</span><input name="currentPassword" type="password" maxlength="128" required autocomplete="current-password" ${CA}></label>
          <label><span>New Password</span><input name="newPassword" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
          <label><span>Confirm New Password</span><input name="newPasswordConfirm" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
          <button class="primary-button" type="submit">Change Password</button>
        </form>

        <form id="user-codeword-create-form" class="stack-form" novalidate>
          <label><span>New Shared Codeword</span><input name="codeword" type="text" maxlength="64" required readonly autocomplete="off" ${CA}></label>
          <small><a href="#" id="regenerate-codeword-link">Regenerate codeword</a></small>
          <button class="primary-button" type="submit">Create Codeword</button>
        </form>

        <div class="card inset-card">
          <h3>Codewords</h3>
          <ul id="user-codeword-list"></ul>
        </div>

        <form id="user-invite-form" class="stack-form" novalidate>
          <label><span>Invite by Email</span><input name="email" type="email" maxlength="254" required autocomplete="email" ${CA}></label>
          <button class="primary-button" type="submit">Send Invite</button>
        </form>

        <div class="status-actions">
          <button id="user-share-link" class="primary-button" type="button">Generate Share Link</button>
          <button id="user-logout" class="destructive-button" type="button">Logout</button>
        </div>
        <div id="user-share-result" class="feedback"></div>

        <form id="user-delete-form" class="stack-form" novalidate>
          <label class="confirm-label"><input type="checkbox" id="user-delete-confirm"><span>Delete my account permanently</span></label>
          <button class="destructive-button" id="user-delete-button" type="submit" disabled>Delete Account</button>
        </form>
        <div id="user-dashboard-feedback" class="feedback" aria-live="polite"></div>
      </section>

      <section id="admin-dashboard" class="card hidden" aria-live="polite">
        <p class="eyebrow">Admin Dashboard</p>
        <h2>Platform controls</h2>
        <p><strong>Total registered users:</strong> <span data-admin="totalUsers">0</span></p>

        <form id="admin-twofa-form" class="stack-form" novalidate>
          <label><span>Admin 2FA Email</span><input name="email" type="email" maxlength="254" autocomplete="email" ${CA}></label>
          <label class="confirm-label"><input type="checkbox" name="enabled"><span>Enable admin email 2FA</span></label>
          <button class="primary-button" type="submit">Save Admin 2FA</button>
        </form>

        <form id="admin-smtp-form" class="stack-form" novalidate>
          <label><span>SMTP Host</span><input name="host" type="text" maxlength="255" autocomplete="off" ${CA}></label>
          <label><span>SMTP Port</span><input name="port" type="number" min="1" max="65535" required ${CA}></label>
          <label><span>SMTP Username</span><input name="user" type="text" maxlength="255" autocomplete="off" ${CA}></label>
          <label><span>SMTP Password</span><input name="pass" type="password" maxlength="255" autocomplete="current-password" ${CA}></label>
          <label class="confirm-label"><input type="checkbox" name="starttls"><span>Require STARTTLS</span></label>
          <button class="primary-button" type="submit">Save SMTP Settings</button>
        </form>

        <div class="status-actions">
          <button id="admin-invite" class="primary-button" type="button">Invite Someone</button>
          <button id="admin-logout" class="destructive-button" type="button">Logout</button>
        </div>
        <div id="admin-dashboard-feedback" class="feedback" aria-live="polite"></div>
      </section>

      <section class="card" id="site-verification">
        <p class="eyebrow">Security verification</p>
        <div id="turnstile-global-widget"></div>
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
        <p>pingme.help is built to limit personal data collection, but no online service is risk-free. By using this website you accept that you do so at your own risk, and that any data you choose to store is also at your own risk.</p>
        <h2>What we store</h2>
        <p>We store account usernames, password hashes, account emails, status updates, optional burn messages, and timestamps needed to show recent activity. We may also process and store email-related settings needed to deliver account, invitation, and verification messages.</p>
        <h2>Network and email limits</h2>
        <p>Even with encrypted storage and security controls, network providers and email providers may still process IP addresses and delivery metadata outside this site’s direct control. No method can guarantee complete anonymity or permanent availability.</p>
        <h2>Availability and alternatives</h2>
        <p>The service may be changed, interrupted, or taken offline at any time without notice. If continuity is critical for you, consider also using additional services such as Dead Man’s Switch alternatives.</p>
        <h2>Your responsibility</h2>
        <p>You are responsible for choosing what to upload and who to share access with. Do not store anything you cannot afford to lose or disclose.</p>
      </article>
    `
  });
}

module.exports = {
  renderHomePage,
  renderPrivacyPage
};
