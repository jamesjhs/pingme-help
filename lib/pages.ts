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
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="PingMe">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <meta name="turnstile-site-key" content="${escapeHtml(turnstileSiteKey)}">
  <title>${safeTitle}</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
  <link rel="stylesheet" href="/assets/styles.css">
  ${hasTurnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>' : ''}
  <script src="/assets/app.js" defer></script>
</head>
<body data-view="${escapeHtml(view)}">
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/">pingme.help</a>
      <div class="topbar-actions">
        <button id="install-app-button" class="icon-button install-app-button hidden" type="button" aria-label="Install app">⤓</button>
        <button id="topbar-share-link" class="topbar-share-link" type="button">Share PingMe</button>
        <a id="topbar-username-link" class="topbar-username-link hidden" href="/"></a>
      </div>
    </header>
    <main class="page">${content}</main>
    <footer class="footer">
      <div>&copy;jahosi.co.uk 2026 | v0.1.0</div>
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
      <section id="logged-in-banner" class="card hidden" aria-live="polite">
        Logged in as <span data-user="usernameBanner"></span>
      </section>

      <section id="home-tabs" class="tabs card" aria-label="Homepage actions">
        <div class="tab-row" role="tablist">
          <button class="tab-button" type="button" id="tab-btn-send" data-tab-target="send-panel" role="tab" aria-selected="false" aria-controls="send-panel">Send a Ping</button>
          <button class="tab-button" type="button" id="tab-btn-register" data-tab-target="register-panel" role="tab" aria-selected="false" aria-controls="register-panel">Register</button>
          <button class="tab-button" type="button" id="tab-btn-login" data-tab-target="login-panel" role="tab" aria-selected="false" aria-controls="login-panel">Login</button>
          <button class="tab-button" type="button" id="tab-btn-check" data-tab-target="check-panel" role="tab" aria-selected="false" aria-controls="check-panel">Check a Ping</button>
          <button class="tab-button hidden" type="button" id="tab-btn-follows" data-tab-target="follows-panel" role="tab" aria-selected="false" aria-controls="follows-panel">Follows</button>
          <button class="tab-button hidden" type="button" id="tab-btn-account" data-tab-target="account-panel" role="tab" aria-selected="false" aria-controls="account-panel">Account</button>
        </div>

        <section id="send-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-send" hidden>
          <form id="send-ping-form" class="stack-form public-send-form" novalidate>
            <label><span>Email Address</span><input name="email" type="email" maxlength="254" required autocomplete="email" ${CA}></label>
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
          <form id="quick-status-form" class="stack-form hidden" novalidate>
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
          <div id="quick-status-feedback" class="feedback hidden" aria-live="polite"></div>
          <div id="send-ping-feedback" class="feedback" aria-live="polite"></div>
        </section>

        <section id="register-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-register" hidden>
          <form id="register-form" class="stack-form" novalidate>
            <label><span>Email Address</span><input name="email" type="email" maxlength="254" required autocomplete="email" ${CA}></label>
            <label><span>Password</span><input name="password" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
            <label><span>Confirm Password</span><input name="passwordConfirm" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
            <div class="register-action-row">
              <div class="register-username-box">
                <span class="register-username-label">Generated Username</span>
                <div class="input-action-row">
                  <input id="register-username" name="username" type="text" maxlength="32" required autocomplete="off" readonly ${CA}>
                  <button id="regenerate-username-button" class="icon-button" type="button" aria-label="Generate another username">
                    <span aria-hidden="true">🔄</span>
                  </button>
                </div>
              </div>
              <button class="primary-button" type="submit" data-public-action>Register</button>
            </div>
          </form>
          <div id="register-feedback" class="feedback" aria-live="polite"></div>
        </section>

        <section id="login-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-login" hidden>
          <form id="login-form" class="stack-form" novalidate>
            <label><span>Email Address</span><input name="email" type="email" maxlength="254" required autocomplete="email" ${CA}></label>
            <label><span>Password</span><input name="password" type="password" maxlength="128" required autocomplete="current-password" ${CA}></label>
            <div class="login-actions-row">
              <button class="primary-button" type="submit" data-public-action>Login</button>
              <button id="forgot-password-button" class="primary-button" type="button" data-public-action>Forgot Password</button>
            </div>
          </form>
          <form id="login-2fa-form" class="stack-form hidden" novalidate>
            <label><span>Secret Code</span><input name="code" type="text" maxlength="6" required autocomplete="one-time-code" ${CA}></label>
            <input name="challengeId" type="hidden" value="">
            <button class="primary-button" type="submit" data-public-action>Verify 2FA</button>
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
            <button class="primary-button" type="submit">Check Status</button>
          </form>
          <div id="check-ping-feedback" class="feedback" aria-live="polite"></div>
          <section id="pinger-dashboard" class="card inset-card hidden" aria-live="polite">
            <h2>Pinger Dashboard</h2>
            <p><strong>User:</strong> <span data-pinger="username"></span></p>
            <div class="status-pill" data-pinger="status"></div>
            <p><strong>Last Updated:</strong> <span data-pinger="lastUpdated"></span></p>
            <button id="pinger-reveal-message" class="blur-card hidden" type="button">View burn message (view once)</button>
            <div id="pinger-message" class="card inset-card hidden"></div>
            <div class="pinger-register-note">
              Want subscription alerts? <a href="/?tab=register">Create an account</a> and follow this username with a shared codeword.
            </div>
          </section>
        </section>

        <section id="follows-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-follows" hidden>
          <form id="follows-check-form" class="stack-form" novalidate>
            <label><span>Username</span><input name="username" type="text" maxlength="32" required autocomplete="off" ${CA}></label>
            <label><span>Shared Codeword</span><input name="codeword" type="password" maxlength="64" required autocomplete="off" ${CA}></label>
            <div class="status-actions">
              <button class="primary-button" type="submit">Check Status</button>
              <button id="follows-toggle-button" class="primary-button" type="button">Follow</button>
            </div>
          </form>
          <div id="follows-feedback" class="feedback" aria-live="polite"></div>
          <section id="follows-status-card" class="card inset-card hidden" aria-live="polite">
            <p><strong>User:</strong> <span data-follows="username"></span></p>
            <div class="status-pill" data-follows="status"></div>
            <p><strong>Last Updated:</strong> <span data-follows="lastUpdated"></span></p>
          </section>
          <section class="card inset-card">
            <h3>Following</h3>
            <ul id="follows-list"></ul>
          </section>
        </section>

        <section id="account-panel" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-account" hidden>
          <section id="user-dashboard" class="card inset-card" aria-live="polite">
            <p class="eyebrow">Account</p>
            <h2>Manage your check-ins and followers</h2>
            <p>
              <strong>Email:</strong>
              <span data-user="email">—</span>
              <span data-user="emailVerificationStatus" class="verification-status">unverified</span>
            </p>
            <p><strong>Last checked by:</strong> <span data-user="lastViewerAccess">Never</span></p>
            <p><strong>Message viewed:</strong> <span data-user="messageViewed">Not viewed</span></p>

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

            <button id="user-resend-verification" class="primary-button" type="button">Resend Verification Email</button>

            <form id="user-twofa-form" class="stack-form" novalidate>
              <label><span>2FA Email</span><input name="email" type="email" maxlength="254" autocomplete="email" ${CA}></label>
              <label class="confirm-label"><input type="checkbox" name="enabled"><span>Enable email 2FA for login</span></label>
              <button class="primary-button" type="submit">Save 2FA Settings</button>
            </form>

            <form id="user-password-form" class="stack-form" novalidate>
              <label><span>Current Password</span><input name="currentPassword" type="password" maxlength="128" required autocomplete="current-password" ${CA}></label>
              <label><span>New Password</span><input name="newPassword" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
              <label><span>Confirm New Password</span><input name="newPasswordConfirm" type="password" maxlength="128" required autocomplete="new-password" ${CA}></label>
              <button class="primary-button" type="submit">Change Password</button>
            </form>

            <form id="user-delete-form" class="stack-form" novalidate>
              <label class="confirm-label"><input type="checkbox" id="user-delete-confirm"><span>Delete my account permanently</span></label>
              <button class="destructive-button" id="user-delete-button" type="submit" disabled>Delete Account</button>
            </form>

            <button id="user-logout" class="destructive-button" type="button">Logout</button>
            <div id="user-dashboard-feedback" class="feedback" aria-live="polite"></div>
          </section>
        </section>

        <div class="home-tabs-verify" id="site-verification">
          <div id="turnstile-global-widget"></div>
        </div>
      </section>

      <section class="card pitch-card" aria-label="About PingMe.help">
        <p class="eyebrow">Why PingMe.help?</p>
        <h2 class="pitch-headline">Someone cares if you get home safe.</h2>
        <p class="pitch-lede">PingMe.help is the private, zero-noise check-in service for people who look out for each other — no apps to install, no accounts to share, no data to sell.</p>
        <ul class="pitch-features">
          <li class="pitch-feature">
            <span class="pitch-icon" aria-hidden="true">🔒</span>
            <div>
              <strong>Ping in under a minute</strong>
              <p>Send a secure status update in seconds. The people you trust always know you're OK — without bombarding them with notifications.</p>
            </div>
          </li>
          <li class="pitch-feature">
            <span class="pitch-icon" aria-hidden="true">🔥</span>
            <div>
              <strong>One-read burn messages</strong>
              <p>Leave a private note that vanishes the moment it's opened. No copies, no logs, no leaks — ever.</p>
            </div>
          </li>
          <li class="pitch-feature">
            <span class="pitch-icon" aria-hidden="true">🤝</span>
            <div>
              <strong>Trusted access only</strong>
              <p>Share a codeword with the people you choose. Only they can check your status — nobody else can see a thing.</p>
            </div>
          </li>
          <li class="pitch-feature">
            <span class="pitch-icon" aria-hidden="true">🚫</span>
            <div>
              <strong>No ads. No tracking. No bloat.</strong>
              <p>Privacy-first by design. We store only what's strictly needed — and nothing more.</p>
            </div>
          </li>
        </ul>
        <button class="primary-button pitch-cta" type="button" data-open-tab="register-panel">Get started — it&#39;s free &rarr;</button>
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
        <h2>Browser sessions and verification</h2>
        <p>During active use the site keeps temporary session tokens in browser memory so the current browser tab can stay signed in and complete protected actions. These tokens are not written to cookies or local storage by the app.</p>
        <p>If bot protection is enabled, Cloudflare Turnstile is loaded to verify that a visitor is human before public forms can be submitted. That challenge is provided by Cloudflare, which may process challenge-related network and browser metadata under its own terms.</p>
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
