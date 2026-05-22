// @ts-nocheck
(function () {
  const view = document.body.dataset.view;
  const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content || '';
  let turnstileWidgetId;
  let turnstileSessionToken = '';
  let turnstileSessionExpiresAt = 0;
  let currentSession = null;
  let pingerSession = null;
  let installPromptEvent = null;
  let setAuthMode = () => {};

  async function setupPwaShell() {
    const installButton = document.getElementById('install-app-link');
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone) {
      document.body.classList.add('pwa-standalone');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPromptEvent = event;
      if (installButton) {
        show(installButton, true);
      }
    });

    window.addEventListener('appinstalled', () => {
      installPromptEvent = null;
      if (installButton) {
        show(installButton, false);
      }
    });

    installButton?.addEventListener('click', async () => {
      if (!installPromptEvent) {
        return;
      }
      installButton.disabled = true;
      installPromptEvent.prompt();
      await installPromptEvent.userChoice.catch(() => null);
      installPromptEvent = null;
      show(installButton, false);
      installButton.disabled = false;
    });
  }

  // ── Version check / cache-bust on deploy ─────────────────────────────────
  const VERSION_STORAGE_KEY = 'pingme_version';
  const VERSION_POLL_MS = 5 * 60 * 1000; // 5 minutes

  async function performAppUpdate() {
    const btn = document.querySelector('#update-banner button');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    let latestVersion = null;
    try {
      const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) { latestVersion = (await r.json()).version; }
    } catch { /* best-effort */ }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      localStorage.removeItem(VERSION_STORAGE_KEY);
      if (latestVersion) {
        localStorage.setItem(VERSION_STORAGE_KEY, latestVersion);
      }
    } catch { /* best-effort */ }
    window.location.reload();
  }

  function showUpdateBanner() {
    if (document.getElementById('update-banner')) {
      return;
    }
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.innerHTML =
      '<span>A new version of pingme.help is available.</span>' +
      '<button type="button">🔄 Update Now</button>';
    banner.querySelector('button')?.addEventListener('click', performAppUpdate);
    document.body.prepend(banner);
  }

  async function checkAssetVersion() {
    try {
      const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) { return; }
      const { version } = await r.json();
      const stored = localStorage.getItem(VERSION_STORAGE_KEY);
      if (stored === null) {
        localStorage.setItem(VERSION_STORAGE_KEY, version);
        return;
      }
      if (stored !== version) {
        showUpdateBanner();
      }
    } catch { /* best-effort */ }
  }

  function setMessage(element, message, tone = 'info') {
    if (!element) {
      return;
    }
    element.textContent = message || '';
    element.dataset.tone = tone;
  }

  function show(element, shouldShow = true) {
    if (!element) {
      return;
    }
    element.hidden = !shouldShow;
    element.classList.toggle('hidden', !shouldShow);
  }

  function setBusy(form, busy) {
    if (!form) {
      return;
    }
    form.querySelectorAll('button').forEach((btn) => {
      btn.disabled = busy || (btn.hasAttribute('data-public-action') && Boolean(siteKey) && !isTurnstileSessionValid());
    });
  }

  function updateCharCount(input, counter) {
    if (!input || !counter) {
      return;
    }
    const remaining = 100 - input.value.length;
    counter.textContent = remaining + ' characters remaining';
    counter.classList.toggle('near-limit', remaining <= 20);
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({ ok: false, error: 'Unexpected response' }));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  function isTurnstileSessionValid() {
    if (!siteKey) {
      return true;
    }
    return Boolean(turnstileSessionToken) && turnstileSessionExpiresAt > Date.now();
  }

  function attachTurnstileSession(payload) {
    if (!siteKey) {
      return payload;
    }
    if (!isTurnstileSessionValid()) {
      throw new Error('Complete the verification once before submitting forms.');
    }
    return {
      ...payload,
      turnstileSessionToken
    };
  }

  function setPublicActionsLocked(locked) {
    document.querySelectorAll('[data-public-action]').forEach((button) => {
      button.disabled = locked;
    });
  }

  function updateHomeLayout() {
    const homeTabs = document.getElementById('home-tabs');
    const quickStatusForm = document.getElementById('quick-status-form');
    const quickStatusFeedback = document.getElementById('quick-status-feedback');
    const publicSendForm = document.getElementById('send-ping-form');
    const sendUserHeading = document.getElementById('send-user-heading');
    const siteVerification = document.getElementById('site-verification');
    const topbarTagline = document.getElementById('topbar-tagline');
    const pitchCard = document.querySelector('.pitch-card');
    const isLoggedIn = Boolean(currentSession);
    const isUser = isLoggedIn && currentSession.role === 'user';
    const isAdmin = isLoggedIn && currentSession.role === 'admin';
    const tabSend = document.getElementById('tab-btn-send');
    const tabCheck = document.getElementById('tab-btn-check');
    const tabLogin = document.getElementById('tab-btn-login');
    const tabAccount = document.getElementById('tab-btn-account');
    const sendPanelCodewords = document.getElementById('send-panel-codewords');
    const checkPanelFollows = document.getElementById('check-panel-follows');
    const checkPingForm = document.getElementById('check-ping-form');
    const checkPingFeedback = document.getElementById('check-ping-feedback');

    show(homeTabs, !isAdmin);
    show(publicSendForm, !isUser);
    show(quickStatusForm, isUser);
    show(quickStatusFeedback, isUser);
    show(sendUserHeading, isUser);
    show(tabSend, !isAdmin);
    show(tabCheck, !isAdmin);
    show(tabLogin, !isLoggedIn);
    show(tabAccount, isUser);
    show(sendPanelCodewords, isUser);
    show(checkPanelFollows, isUser);
    show(checkPingForm, !isUser);
    show(checkPingFeedback, !isUser);
    show(siteVerification, !isLoggedIn);
    show(topbarTagline, !isLoggedIn);
    if (pitchCard) {
      pitchCard.hidden = isLoggedIn;
    }
    updateTopbarUserLink();
  }

  function formatFriendlyTime(value, fallback = 'Never') {
    if (!value) {
      return fallback;
    }
    let candidate = value;
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
      const numeric = Number(value);
      candidate = value.length <= 10 ? numeric * 1000 : numeric;
    }
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function getShareLink() {
    if (currentSession && currentSession.role === 'user') {
      return `${window.location.origin}/?tab=check&user=${encodeURIComponent(currentSession.username)}`;
    }
    return window.location.origin;
  }

  function showSharePopup(message) {
    const existing = document.getElementById('share-toast-popup');
    if (existing) {
      existing.remove();
    }
    const popup = document.createElement('div');
    popup.id = 'share-toast-popup';
    popup.className = 'toast-popup';
    popup.innerHTML = `<span>${message}</span><button type="button" aria-label="Close share popup">Close</button>`;
    popup.querySelector('button')?.addEventListener('click', () => popup.remove());
    document.body.appendChild(popup);
  }

  function updateTopbarUserLink() {
    const topbarUsernameLink = document.getElementById('topbar-username-link');
    if (!topbarUsernameLink) {
      return;
    }
    const isUser = Boolean(currentSession && currentSession.role === 'user');
    show(topbarUsernameLink, isUser);
    if (isUser) {
      topbarUsernameLink.textContent = 'Hello ' + currentSession.username;
      topbarUsernameLink.href = '/?tab=account';
    }
  }

  function mountTurnstile() {
    const shell = document.getElementById('turnstile-global-widget');
    if (!shell) {
      return;
    }

    if (!siteKey) {
      setPublicActionsLocked(false);
      return;
    }

    setPublicActionsLocked(true);

    const renderWidget = function () {
      if (turnstileWidgetId !== undefined) {
        return;
      }
      turnstileWidgetId = window.turnstile.render(shell, {
        sitekey: siteKey,
        theme: 'dark',
        callback: async (token) => {
          try {
            const data = await postJson('/api/turnstile/session', { turnstileToken: token });
            if (data.bypass) {
              turnstileSessionToken = '';
              turnstileSessionExpiresAt = Number.MAX_SAFE_INTEGER;
              setPublicActionsLocked(false);
              return;
            }
            turnstileSessionToken = data.turnstile_session_token;
            turnstileSessionExpiresAt = Date.now() + Number(data.expires_in_ms || 0);
            setPublicActionsLocked(false);
          } catch {
            turnstileSessionToken = '';
            turnstileSessionExpiresAt = 0;
            setPublicActionsLocked(true);
          }
        },
        'expired-callback': () => {
          turnstileSessionToken = '';
          turnstileSessionExpiresAt = 0;
          setPublicActionsLocked(true);
        },
        'error-callback': () => {
          turnstileSessionToken = '';
          turnstileSessionExpiresAt = 0;
          setPublicActionsLocked(true);
        }
      });
    };

    if (window.turnstile) {
      renderWidget();
      return;
    }

    window.addEventListener('load', renderWidget, { once: true });
  }

  function resetTurnstileSession() {
    turnstileSessionToken = '';
    turnstileSessionExpiresAt = 0;
    setPublicActionsLocked(Boolean(siteKey));
    if (turnstileWidgetId !== undefined && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }

  function initTabs() {
    function activateTab(target, allowCollapse) {
      const alreadyActive = !!(document.querySelector('.tab-button[data-tab-target="' + target + '"]')?.classList.contains('is-active'));
      document.querySelectorAll('.tab-button').forEach((item) => {
        item.classList.remove('is-active');
        item.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.remove('is-active');
        panel.hidden = true;
      });
      if (!allowCollapse || !alreadyActive) {
        const button = document.querySelector('.tab-button[data-tab-target="' + target + '"]');
        const panel = document.getElementById(target);
        if (button) {
          button.classList.add('is-active');
          button.setAttribute('aria-selected', 'true');
        }
        if (panel) {
          panel.classList.add('is-active');
          panel.hidden = false;
        }
      }
    }
    document.querySelectorAll('[data-tab-target]').forEach((button) => {
      button.addEventListener('click', () => activateTab(button.dataset.tabTarget, true));
    });
    return activateTab;
  }

  function setCodewordList(items) {
    const list = document.getElementById('user-codeword-list');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('li');
      row.innerHTML = `
        <div><strong>${item.codeword}</strong> — ${item.is_active ? 'active' : 'disabled'}</div>
        <div>Last viewed: ${formatFriendlyTime(item.last_checked_at)}</div>
      `;
      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'text-link-button';
      toggleButton.textContent = item.is_active ? '[Suspend]' : '[Resume]';
      toggleButton.addEventListener('click', async () => {
        if (!currentSession) {
          return;
        }
        try {
          const result = await postJson('/api/user/codewords/disable', {
            sessionToken: currentSession.sessionToken,
            id: item.id,
            enabled: !Boolean(item.is_active)
          });
          setCodewordList(result.codewords || []);
        } catch {
          // no-op
        }
      });
      const reshareButton = document.createElement('button');
      reshareButton.type = 'button';
      reshareButton.className = 'text-link-button';
      reshareButton.textContent = '[Share again]';
      reshareButton.addEventListener('click', async () => {
        const link = `${window.location.origin}/?tab=check&user=${encodeURIComponent(currentSession?.username || '')}`;
        const shareText = `PingMe check\nUsername: ${currentSession?.username || ''}\nCodeword: ${item.codeword}\nLink: ${link}`;
        await navigator.clipboard.writeText(shareText).catch(() => {});
        showSharePopup(`Copied! Share this:\nLink: ${link}\nCodeword: ${item.codeword}`);
      });
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'text-link-button';
      deleteButton.textContent = '[Delete]';
      deleteButton.addEventListener('click', async () => {
        if (!currentSession) {
          return;
        }
        try {
          const result = await postJson('/api/user/codewords/delete', {
            sessionToken: currentSession.sessionToken,
            id: item.id
          });
          setCodewordList(result.codewords || []);
        } catch {
          // no-op
        }
      });
      const actions = document.createElement('div');
      actions.className = 'codeword-actions';
      actions.appendChild(toggleButton);
      actions.appendChild(reshareButton);
      actions.appendChild(deleteButton);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function setFollowButtonState(username, codeword) {
    const toggleButton = document.getElementById('follows-toggle-button');
    const list = document.getElementById('follows-list');
    if (!toggleButton || !list) {
      return;
    }
    const targetUser = String(username || '').trim().toLowerCase();
    const targetCodeword = String(codeword || '').trim().toLowerCase();
    const isFollowing = Array.from(list.querySelectorAll('li')).some((row) => {
      return row.dataset.username === targetUser && row.dataset.codeword === targetCodeword;
    });
    toggleButton.textContent = isFollowing ? 'Unfollow' : 'Follow';
  }

  function setFollowsStatusCard({ username, status, lastUpdated }) {
    const card = document.getElementById('follows-status-card');
    if (!card) {
      return;
    }
    card.querySelector('[data-follows="username"]').textContent = username || '';
    const pill = card.querySelector('[data-follows="status"]');
    if (status === null || status === undefined) {
      pill.textContent = 'Unknown';
      delete pill.dataset.state;
    } else {
      pill.textContent = status ? '🟢 OK' : '🔴 Not OK';
      pill.dataset.state = status ? 'ok' : 'not-ok';
    }
    card.querySelector('[data-follows="lastUpdated"]').textContent = formatFriendlyTime(lastUpdated);
    show(card, true);
  }

  function setFollowsList(items) {
    const list = document.getElementById('follows-list');
    const followsListCard = document.getElementById('follows-list-card');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    show(followsListCard, Array.isArray(items) && items.length > 0);
    items.forEach((item) => {
      const row = document.createElement('li');
      row.className = 'follows-row';
      row.dataset.followId = String(item.id || '');
      row.dataset.username = String(item.target_username || '').toLowerCase();
      row.dataset.codeword = String(item.codeword || '').toLowerCase();
      row.innerHTML = `<div><strong>${item.target_username}</strong> — ${item.codeword}</div>`;

      if (item.status !== null && item.status !== undefined) {
        const pill = document.createElement('div');
        pill.className = 'status-pill';
        pill.dataset.state = item.status ? 'ok' : 'not-ok';
        pill.textContent = item.status ? '🟢 OK' : '🔴 Not OK';
        row.appendChild(pill);
      }

      const time = document.createElement('div');
      time.textContent = `Last updated: ${formatFriendlyTime(item.last_status_update)}`;
      row.appendChild(time);

      const actions = document.createElement('div');
      actions.className = 'codeword-actions';

      const refreshButton = document.createElement('button');
      refreshButton.type = 'button';
      refreshButton.className = 'primary-button';
      refreshButton.textContent = 'Check';
      refreshButton.addEventListener('click', async () => {
        if (!currentSession) {
          return;
        }
        try {
          const data = await postJson('/api/user/follows/check', {
            sessionToken: currentSession.sessionToken,
            username: item.target_username,
            codeword: item.codeword
          });
          setFollowsStatusCard({
            username: data.username,
            status: data.status,
            lastUpdated: data.last_status_update
          });
          setFollowsList(data.follows || []);
        } catch {
          // no-op
        }
      });

      const unfollowButton = document.createElement('button');
      unfollowButton.type = 'button';
      unfollowButton.className = 'destructive-button';
      unfollowButton.textContent = 'Unfollow';
      unfollowButton.addEventListener('click', async () => {
        if (!currentSession) {
          return;
        }
        try {
          const data = await postJson('/api/user/follows/remove', {
            sessionToken: currentSession.sessionToken,
            id: item.id
          });
          setFollowsList(data.follows || []);
        } catch {
          // no-op
        }
      });

      actions.appendChild(refreshButton);
      actions.appendChild(unfollowButton);
      row.appendChild(actions);
      list.appendChild(row);
    });
    const followsCheckForm = document.getElementById('follows-check-form');
    if (followsCheckForm) {
      const payload = formPayload(followsCheckForm);
      setFollowButtonState(payload.username, payload.codeword);
    }
  }

  function applyUserDashboard(data) {
    const dashboard = document.getElementById('user-dashboard');
    const adminDashboard = document.getElementById('admin-dashboard');
    show(adminDashboard, false);
    updateHomeLayout();

    const userStats = (data.dashboard && data.dashboard.user) || {};
    const verifyLink = document.getElementById('twofa-email-verify-link');
    if (verifyLink) {
      const hasEmail = Boolean(userStats.email);
      const verified = Boolean(userStats.email_verified);
      verifyLink.textContent = verified ? 'verified' : 'unverified';
      verifyLink.dataset.state = verified ? 'verified' : 'unverified';
      verifyLink.disabled = !hasEmail || verified;
      show(verifyLink, hasEmail);
    }
    const twofaForm = document.getElementById('user-twofa-form');
    if (twofaForm) {
      twofaForm.elements.email.value = userStats.email || '';
      twofaForm.elements.enabled.checked = Boolean(userStats.twofa_enabled);
    }
    setCodewordList(userStats.codewords || []);
    setFollowsList(userStats.follows || []);
  }

  function applyAdminDashboard(data) {
    const dashboard = document.getElementById('admin-dashboard');
    const userDashboard = document.getElementById('user-dashboard');
    show(userDashboard, false);
    show(dashboard, true);
    updateHomeLayout();

    const total = dashboard.querySelector('[data-admin="totalUsers"]');
    if (total) {
      total.textContent = String(data.dashboard?.total_users || 0);
    }

    const smtp = data.dashboard?.smtp || {};
    const smtpForm = document.getElementById('admin-smtp-form');
    if (smtpForm) {
      smtpForm.elements.host.value = smtp.host || '';
      smtpForm.elements.port.value = smtp.port || 587;
      smtpForm.elements.user.value = smtp.user || '';
      smtpForm.elements.pass.value = smtp.pass || '';
      smtpForm.elements.starttls.checked = Boolean(smtp.starttls);
    }

    const twofa = document.getElementById('admin-twofa-form');
    if (twofa) {
      twofa.elements.email.value = data.dashboard?.email || '';
      twofa.elements.enabled.checked = Boolean(data.dashboard?.twofa_enabled);
    }
  }

  async function logoutAll() {
    const token = (currentSession && currentSession.sessionToken) || (pingerSession && pingerSession.sessionToken) || '';
    if (token) {
      await postJson('/api/logout', { sessionToken: token }).catch(() => {});
    }
    currentSession = null;
    pingerSession = null;
    show(document.getElementById('user-dashboard'), false);
    show(document.getElementById('admin-dashboard'), false);
    show(document.getElementById('pinger-dashboard'), false);
    updateHomeLayout();
    // Switch to the login tab so the user sees a clean logged-out state
    const activateTab = initTabs();
    activateTab('login-panel', false);
    setAuthMode('login');
  }

  async function fetchRegisterSuggestion() {
    const data = await postJson('/api/register/suggest', {});
    return data.username;
  }

  function initHome() {
    const activateTab = initTabs();
    updateHomeLayout();

    // Deep-link: open a specific tab from URL params (e.g. share links with ?tab=check&user=...)
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam) {
      if (tabParam === 'register') {
        activateTab('login-panel', false);
        setAuthMode('register');
      } else {
        activateTab(tabParam + '-panel', false);
      }
    }
    const userParam = params.get('user');
    if (userParam) {
      const checkUsernameInput = document.querySelector('#check-panel input[name="username"]');
      if (checkUsernameInput) {
        checkUsernameInput.value = userParam;
      }
    }

    // CTA "Get started" button on pitch card opens auth tab
    document.querySelectorAll('[data-open-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.openTab;
        const authMode = button.dataset.authMode;
        activateTab(target, false);
        if (authMode === 'register') {
          setAuthMode('register');
        }
        document.getElementById('home-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Prevent the topbar username link from reloading the page (session is in memory)
    document.getElementById('topbar-username-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab('account-panel', false);
      document.getElementById('home-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const sendPingForm = document.getElementById('send-ping-form');
    const sendPingFeedback = document.getElementById('send-ping-feedback');
    const quickStatusForm = document.getElementById('quick-status-form');
    const quickStatusFeedback = document.getElementById('quick-status-feedback');
    const registerForm = document.getElementById('register-form');
    const registerFeedback = document.getElementById('register-feedback');
    const registerUsername = document.getElementById('register-username');
    const regenerateUsernameButton = document.getElementById('regenerate-username-button');
    const regenerateCodewordButton = document.getElementById('regenerate-codeword-button');
    const shareCodwordButton = document.getElementById('share-codeword-button');
    const userCodewordCreateForm = document.getElementById('user-codeword-create-form');
    const loginForm = document.getElementById('login-form');
    const showRegisterLink = document.getElementById('show-register-link');
    const showLoginLink = document.getElementById('show-login-link');
    const login2faForm = document.getElementById('login-2fa-form');
    const loginFeedback = document.getElementById('login-feedback');
    const forgotPasswordButton = document.getElementById('forgot-password-button');
    const resetConfirmForm = document.getElementById('password-reset-confirm-form');
    const checkPingForm = document.getElementById('check-ping-form');
    const checkPingFeedback = document.getElementById('check-ping-feedback');

    const pingerDashboard = document.getElementById('pinger-dashboard');
    const pingerRevealButton = document.getElementById('pinger-reveal-message');
    const pingerMessage = document.getElementById('pinger-message');
    const pingerIpCaveat = document.getElementById('pinger-ip-caveat');
    const followsCheckForm = document.getElementById('follows-check-form');
    const followsFeedback = document.getElementById('follows-feedback');

    const userDashboardFeedback = document.getElementById('user-dashboard-feedback');
    const adminDashboardFeedback = document.getElementById('admin-dashboard-feedback');

    const burnInput = document.getElementById('burn-message-input');
    const burnCharCount = document.getElementById('burn-char-count');
    const quickBurnInput = document.getElementById('quick-burn-message-input');
    const quickBurnCharCount = document.getElementById('quick-burn-char-count');
    const sendIpSharePrompt = document.getElementById('send-ip-share-prompt');
    const sendIpShareInput = document.getElementById('send-ip-share-input');
    const quickIpSharePrompt = document.getElementById('quick-ip-share-prompt');
    const quickIpShareInput = document.getElementById('quick-ip-share-input');

    burnInput?.addEventListener('input', () => updateCharCount(burnInput, burnCharCount));
    quickBurnInput?.addEventListener('input', () => updateCharCount(quickBurnInput, quickBurnCharCount));
    updateCharCount(burnInput, burnCharCount);
    updateCharCount(quickBurnInput, quickBurnCharCount);

    const syncIpSharePrompt = (statusValue, promptEl, checkboxEl) => {
      const shouldShow = statusValue === 'not_ok';
      show(promptEl, shouldShow);
      if (!shouldShow && checkboxEl) {
        checkboxEl.checked = false;
      }
    };

    const refreshUserCodeword = () => {
      const input = userCodewordCreateForm?.elements?.codeword;
      if (!input) {
        return;
      }
      if (!currentSession) {
        input.value = '';
        return;
      }
      postJson('/api/user/codewords/suggest', { sessionToken: currentSession.sessionToken })
        .then((data) => {
          input.value = data.codeword || '';
        })
        .catch(() => {
          input.value = '';
        });
    };

    const completeUserLogin = (data, username, message = '') => {
      currentSession = {
        sessionToken: data.session_token,
        role: data.role,
        username
      };
      applyUserDashboard(data);
      activateTab('send-panel', false);
      refreshUserCodeword();
      setMessage(userDashboardFeedback, message, message ? 'success' : 'info');
    };
    let pendingLoginUsername = '';

    setAuthMode = (mode) => {
      const showRegister = mode === 'register';
      show(loginForm, !showRegister);
      show(registerForm, showRegister);
      show(login2faForm, false);
      show(resetConfirmForm, false);
      if (!showRegister) {
        setMessage(registerFeedback, '');
      } else {
        setMessage(loginFeedback, '');
      }
    };

    setAuthMode('login');

    if (registerForm) {
      const suggest = async () => {
        try {
          regenerateUsernameButton.disabled = true;
          const suggestedUsername = await fetchRegisterSuggestion();
          registerUsername.value = suggestedUsername;
        } catch (error) {
          setMessage(registerFeedback, error.message, 'error');
        } finally {
          regenerateUsernameButton.disabled = false;
        }
      };
      suggest();
      regenerateUsernameButton?.addEventListener('click', suggest);

      registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(registerFeedback, 'Registering…');
        setBusy(registerForm, true);
        try {
          const payload = attachTurnstileSession(formPayload(registerForm));
          const data = await postJson('/api/register', payload);
          registerForm.reset();
          await suggest();
          show(login2faForm, false);
          completeUserLogin(
            data,
            data.username,
            data.verification_email_sent
              ? `Welcome, ${data.username}. First codeword: ${data.codeword}. Check your email to verify your address.`
              : `Welcome, ${data.username}. First codeword: ${data.codeword}.`
          );
        } catch (error) {
          setMessage(registerFeedback, error.message, 'error');
          if (siteKey) {
            resetTurnstileSession();
          }
        } finally {
          setBusy(registerForm, false);
        }
      });
    }

    showRegisterLink?.addEventListener('click', () => {
      setAuthMode('register');
    });
    showLoginLink?.addEventListener('click', () => {
      setAuthMode('login');
    });

    document.querySelectorAll('[data-status-value]').forEach((button) => {
      button.addEventListener('click', async () => {
        sendPingForm.elements.status.value = button.dataset.statusValue;
        syncIpSharePrompt(sendPingForm.elements.status.value, sendIpSharePrompt, sendIpShareInput);
        setMessage(sendPingFeedback, 'Saving status…');
        setBusy(sendPingForm, true);
        try {
          const payload = attachTurnstileSession(formPayload(sendPingForm));
          const result = await postJson('/api/send-ping', payload);
          setMessage(sendPingFeedback, 'Saved.', 'success');
          sendPingForm.reset();
          updateCharCount(burnInput, burnCharCount);
          syncIpSharePrompt(sendPingForm.elements.status.value, sendIpSharePrompt, sendIpShareInput);
        } catch (error) {
          setMessage(sendPingFeedback, error.message, 'error');
          if (siteKey) {
            resetTurnstileSession();
          }
        } finally {
          setBusy(sendPingForm, false);
        }
      });
    });

    document.querySelectorAll('[data-quick-status-value]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!currentSession) {
          return;
        }
        quickStatusForm.elements.status.value = button.dataset.quickStatusValue;
        syncIpSharePrompt(quickStatusForm.elements.status.value, quickIpSharePrompt, quickIpShareInput);
        setMessage(quickStatusFeedback, 'Saving status…');
        setBusy(quickStatusForm, true);
        try {
          const result = await postJson('/api/user/status', {
            sessionToken: currentSession.sessionToken,
            ...formPayload(quickStatusForm)
          });
          setMessage(
            quickStatusFeedback,
            `Saved. Last checked: ${formatFriendlyTime(result.private_stats.last_viewer_access)}. Burn message viewed: ${result.private_stats.message_viewed_flag ? 'yes' : 'no'}.`,
            'success'
          );
          quickStatusForm.reset();
          updateCharCount(quickBurnInput, quickBurnCharCount);
          syncIpSharePrompt(quickStatusForm.elements.status.value, quickIpSharePrompt, quickIpShareInput);
          applyUserDashboard({ dashboard: { user: { ...(await postJson('/api/session/refresh', { sessionToken: currentSession.sessionToken })).dashboard.user } } });
        } catch (error) {
          setMessage(quickStatusFeedback, error.message, 'error');
        } finally {
          setBusy(quickStatusForm, false);
        }
      });
    });
    syncIpSharePrompt(sendPingForm?.elements?.status?.value, sendIpSharePrompt, sendIpShareInput);
    syncIpSharePrompt(quickStatusForm?.elements?.status?.value, quickIpSharePrompt, quickIpShareInput);

    loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(loginForm, true);
      setMessage(loginFeedback, 'Signing in…');
      try {
        const rawPayload = formPayload(loginForm);
        const payload = attachTurnstileSession({
          identifier: rawPayload.identifier,
          password: rawPayload.password
        });
        const data = await postJson('/api/login/start', payload);
        pendingLoginUsername = data.username || '';
        if (data.requires_2fa) {
          show(loginForm, false);
          show(login2faForm, true);
          login2faForm.elements.challengeId.value = data.challenge_id;
          setMessage(loginFeedback, '2FA code sent. Enter it below.', 'success');
          return;
        }
        if (data.role === 'admin') {
          currentSession = {
            sessionToken: data.session_token,
            role: data.role,
            username: data.username || 'admin'
          };
          applyAdminDashboard(data);
          setMessage(adminDashboardFeedback, 'Welcome back.', 'success');
        } else {
          completeUserLogin(data, data.username);
        }
        setMessage(loginFeedback, '', 'success');
      } catch (error) {
        setMessage(loginFeedback, error.message, 'error');
        if (siteKey) {
          resetTurnstileSession();
        }
      } finally {
        setBusy(loginForm, false);
      }
    });

    login2faForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(login2faForm, true);
      setMessage(loginFeedback, 'Verifying code…');
      try {
        const rawPayload = formPayload(login2faForm);
        const payload = attachTurnstileSession({
          challengeId: rawPayload.challengeId,
          code: String(rawPayload.code || '').replace(/\D+/g, '').slice(0, 6)
        });
        const data = await postJson('/api/login/verify-2fa', payload);
        show(login2faForm, false);
        show(loginForm, true);
        if (data.role === 'admin') {
          currentSession = {
            sessionToken: data.session_token,
            role: data.role,
            username: data.username || pendingLoginUsername || 'admin'
          };
          applyAdminDashboard(data);
          setMessage(adminDashboardFeedback, 'Welcome back.', 'success');
        } else {
          completeUserLogin(data, data.username || pendingLoginUsername);
        }
        setMessage(loginFeedback, '', 'success');
      } catch (error) {
        setMessage(loginFeedback, error.message, 'error');
        if (siteKey) {
          resetTurnstileSession();
        }
      } finally {
        setBusy(login2faForm, false);
      }
    });

    forgotPasswordButton?.addEventListener('click', async () => {
      if (!loginForm) {
        return;
      }
      const identifier = String(loginForm.elements.identifier?.value || '').trim();
      const email = identifier.includes('@') ? identifier : '';
      if (!email) {
        setMessage(loginFeedback, 'Enter an email address in the login field first.', 'error');
        return;
      }
      forgotPasswordButton.disabled = true;
      setMessage(loginFeedback, 'Sending reset code…');
      try {
        const payload = attachTurnstileSession({ email });
        const data = await postJson('/api/password-reset/request', payload);
        if (data.challenge_id) {
          show(resetConfirmForm, true);
          resetConfirmForm.elements.challengeId.value = data.challenge_id;
        }
        setMessage(loginFeedback, 'If the account exists, a reset code was sent.', 'success');
      } catch (error) {
        setMessage(loginFeedback, error.message, 'error');
        if (siteKey) {
          resetTurnstileSession();
        }
      } finally {
        forgotPasswordButton.disabled = false;
      }
    });

    resetConfirmForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(resetConfirmForm, true);
      setMessage(loginFeedback, 'Resetting password…');
      try {
        const payload = attachTurnstileSession(formPayload(resetConfirmForm));
        await postJson('/api/password-reset/confirm', payload);
        setMessage(loginFeedback, 'Password updated.', 'success');
        resetConfirmForm.reset();
        show(resetConfirmForm, false);
      } catch (error) {
        setMessage(loginFeedback, error.message, 'error');
        if (siteKey) {
          resetTurnstileSession();
        }
      } finally {
        setBusy(resetConfirmForm, false);
      }
    });

    login2faForm?.elements?.code?.addEventListener('input', () => {
      const input = login2faForm.elements.code;
      input.value = String(input.value || '').replace(/\D+/g, '').slice(0, 6);
    });

    checkPingForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(checkPingForm, true);
      setMessage(checkPingFeedback, 'Checking status…');
      try {
        const basePayload = formPayload(checkPingForm);
        const payload = currentSession
          ? { ...basePayload, sessionToken: currentSession.sessionToken }
          : attachTurnstileSession(basePayload);
        const data = await postJson('/api/check-ping', payload);
        pingerSession = {
          sessionToken: data.session_token,
          username: payload.username
        };
        pingerDashboard.querySelector('[data-pinger="username"]').textContent = payload.username;
        const statusPill = pingerDashboard.querySelector('[data-pinger="status"]');
        statusPill.textContent = data.status ? '🟢 OK' : '🔴 Not OK';
        statusPill.dataset.state = data.status ? 'ok' : 'not-ok';
        pingerDashboard.querySelector('[data-pinger="lastUpdated"]').textContent = formatFriendlyTime(data.last_status_update);
        show(pingerRevealButton, data.has_message);
        show(pingerMessage, false);
        show(pingerIpCaveat, true);
        show(pingerDashboard, true);
        setMessage(checkPingFeedback, 'Status unlocked.', 'success');
      } catch (error) {
        setMessage(checkPingFeedback, error.message, 'error');
        if (siteKey) {
          resetTurnstileSession();
        }
      } finally {
        setBusy(checkPingForm, false);
      }
    });

    pingerRevealButton?.addEventListener('click', async () => {
      if (!pingerSession) {
        return;
      }
      setMessage(checkPingFeedback, 'Opening burn message…');
      pingerRevealButton.disabled = true;
      try {
        const data = await postJson('/api/pinger/reveal', {
          sessionToken: pingerSession.sessionToken
        });
        pingerMessage.textContent = data.message || 'No burn message is available.';
        show(pingerMessage, true);
        show(pingerRevealButton, false);
        setMessage(checkPingFeedback, 'Burn message opened and cleared.', 'success');
      } catch (error) {
        pingerRevealButton.disabled = false;
        setMessage(checkPingFeedback, error.message, 'error');
      }
    });

    document.getElementById('user-twofa-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession) {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        const data = await postJson('/api/user/twofa', {
          sessionToken: currentSession.sessionToken,
          email: payload.email,
          enabled: payload.enabled === 'on'
        });
        applyUserDashboard(data);
        setMessage(
          userDashboardFeedback,
          data.verification_email_sent ? '2FA settings updated. Check your email to verify the address.' : '2FA settings updated.',
          'success'
        );
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    document.getElementById('twofa-email-verify-link')?.addEventListener('click', async (event) => {
      if (!currentSession) {
        return;
      }
      const button = event.currentTarget;
      if (button.dataset.state === 'verified') {
        return;
      }
      button.disabled = true;
      try {
        const data = await postJson('/api/user/email-verification/resend', {
          sessionToken: currentSession.sessionToken
        });
        applyUserDashboard(data);
        setMessage(
          userDashboardFeedback,
          data.verification_email_sent ? 'Verification email sent.' : 'Email delivery is not configured.',
          data.verification_email_sent ? 'success' : 'error'
        );
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('user-password-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession) {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        await postJson('/api/user/password', {
          sessionToken: currentSession.sessionToken,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
          newPasswordConfirm: payload.newPasswordConfirm
        });
        form.reset();
        setMessage(userDashboardFeedback, 'Password updated.', 'success');
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    userCodewordCreateForm?.addEventListener('submit', (event) => {
      event.preventDefault();
    });

    regenerateCodewordButton?.addEventListener('click', () => {
      refreshUserCodeword();
    });

    shareCodwordButton?.addEventListener('click', async () => {
      if (!currentSession) {
        return;
      }
      const input = userCodewordCreateForm?.elements?.codeword;
      const codeword = String(input?.value || '').trim();
      if (!codeword) {
        return;
      }
      shareCodwordButton.disabled = true;
      try {
        const data = await postJson('/api/user/codewords/create', {
          sessionToken: currentSession.sessionToken,
          codeword
        });
        setCodewordList(data.codewords || []);
        refreshUserCodeword();
        const link = `${window.location.origin}/?tab=check&user=${encodeURIComponent(currentSession.username)}`;
        const shareText = `PingMe check\nUsername: ${currentSession.username}\nCodeword: ${codeword}\nLink: ${link}`;
        await navigator.clipboard.writeText(shareText).catch(() => {});
        showSharePopup(`Copied! Share this:\nLink: ${link}\nCodeword: ${codeword}`);
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        shareCodwordButton.disabled = false;
      }
    });

    document.getElementById('user-invite-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession) {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        await postJson('/api/invite', {
          sessionToken: currentSession.sessionToken,
          email: payload.email
        });
        form.reset();
        setMessage(userDashboardFeedback, 'Invite sent.', 'success');
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    const userDeleteConfirm = document.getElementById('user-delete-confirm');
    const userDeleteButton = document.getElementById('user-delete-button');
    userDeleteConfirm?.addEventListener('change', () => {
      userDeleteButton.disabled = !userDeleteConfirm.checked;
    });

    document.getElementById('user-delete-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession) {
        return;
      }
      try {
        await postJson('/api/user/delete-account', { sessionToken: currentSession.sessionToken });
        await logoutAll();
        setMessage(userDashboardFeedback, 'Account deleted.', 'success');
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      }
    });

    document.getElementById('user-logout')?.addEventListener('click', async () => {
      await logoutAll();
      setMessage(userDashboardFeedback, 'Logged out.', 'success');
    });

    followsCheckForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession) {
        return;
      }
      setBusy(followsCheckForm, true);
      try {
        const payload = formPayload(followsCheckForm);
        const data = await postJson('/api/user/follows/check', {
          sessionToken: currentSession.sessionToken,
          username: payload.username,
          codeword: payload.codeword
        });
        setFollowsStatusCard({
          username: data.username,
          status: data.status,
          lastUpdated: data.last_status_update
        });
        setFollowsList(data.follows || []);
        setFollowButtonState(payload.username, payload.codeword);
        setMessage(followsFeedback, 'Status checked.', 'success');
      } catch (error) {
        setMessage(followsFeedback, error.message, 'error');
      } finally {
        setBusy(followsCheckForm, false);
      }
    });

    document.getElementById('follows-toggle-button')?.addEventListener('click', async () => {
      if (!currentSession || !followsCheckForm) {
        return;
      }
      const payload = formPayload(followsCheckForm);
      const username = String(payload.username || '').trim();
      const codeword = String(payload.codeword || '').trim();
      if (!username || !codeword) {
        setMessage(followsFeedback, 'Enter username and shared codeword first.', 'error');
        return;
      }
      const list = document.getElementById('follows-list');
      const match = Array.from(list?.querySelectorAll('li') || []).find((row) => row.dataset.username === username.toLowerCase() && row.dataset.codeword === codeword.toLowerCase());
      try {
        if (match) {
          const id = Number(match.dataset.followId || 0);
          const data = await postJson('/api/user/follows/remove', { sessionToken: currentSession.sessionToken, id });
          setFollowsList(data.follows || []);
          setMessage(followsFeedback, 'Unfollowed.', 'success');
        } else {
          const data = await postJson('/api/user/follows/add', {
            sessionToken: currentSession.sessionToken,
            username,
            codeword
          });
          setFollowsList(data.follows || []);
          setMessage(followsFeedback, 'Followed.', 'success');
        }
      } catch (error) {
        setMessage(followsFeedback, error.message, 'error');
      } finally {
        setFollowButtonState(username, codeword);
      }
    });

    followsCheckForm?.addEventListener('input', () => {
      const payload = formPayload(followsCheckForm);
      setFollowButtonState(payload.username, payload.codeword);
    });

    document.getElementById('admin-twofa-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession || currentSession.role !== 'admin') {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        await postJson('/api/admin/twofa', {
          sessionToken: currentSession.sessionToken,
          email: payload.email,
          enabled: payload.enabled === 'on'
        });
        setMessage(adminDashboardFeedback, 'Admin 2FA updated.', 'success');
      } catch (error) {
        setMessage(adminDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    document.getElementById('admin-password-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession || currentSession.role !== 'admin') {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        await postJson('/api/admin/password', {
          sessionToken: currentSession.sessionToken,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
          newPasswordConfirm: payload.newPasswordConfirm
        });
        form.reset();
        setMessage(adminDashboardFeedback, 'Admin password updated.', 'success');
      } catch (error) {
        setMessage(adminDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    document.getElementById('admin-smtp-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession || currentSession.role !== 'admin') {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        const data = await postJson('/api/admin/smtp', {
          sessionToken: currentSession.sessionToken,
          host: payload.host,
          port: Number(payload.port),
          user: payload.user,
          pass: payload.pass,
          starttls: payload.starttls === 'on'
        });
        applyAdminDashboard({ dashboard: { total_users: data.total_users, smtp: data.smtp } });
        setMessage(adminDashboardFeedback, 'SMTP settings saved.', 'success');
      } catch (error) {
        setMessage(adminDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    document.getElementById('admin-invite')?.addEventListener('click', async () => {
      if (!currentSession || currentSession.role !== 'admin') {
        return;
      }
      const email = window.prompt('Invite email address');
      if (!email) {
        return;
      }
      try {
        await postJson('/api/invite', {
          sessionToken: currentSession.sessionToken,
          email
        });
        setMessage(adminDashboardFeedback, 'Invite sent.', 'success');
      } catch (error) {
        setMessage(adminDashboardFeedback, error.message, 'error');
      }
    });

    document.getElementById('admin-logout')?.addEventListener('click', async () => {
      await logoutAll();
      setMessage(adminDashboardFeedback, 'Logged out.', 'success');
    });

    refreshUserCodeword();
  }

  setupPwaShell();
  mountTurnstile();
  checkAssetVersion();
  setInterval(checkAssetVersion, VERSION_POLL_MS);
  document.getElementById('footer-share-link')?.addEventListener('click', async () => {
    const link = getShareLink();
    const ok = await navigator.clipboard.writeText(link).then(() => true, () => false);
    showSharePopup(ok ? 'share link copied' : 'could not copy — link: ' + link);
  });

  if (view === 'home') {
    initHome();
  }
}());
