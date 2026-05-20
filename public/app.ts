// @ts-nocheck
(function () {
  const view = document.body.dataset.view;
  const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content || '';
  let turnstileWidgetId;
  let turnstileSessionToken = '';
  let turnstileSessionExpiresAt = 0;
  let currentSession = null;
  let pingerSession = null;

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
      btn.disabled = busy;
    });
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

  function mountTurnstile() {
    const shell = document.getElementById('turnstile-global-widget');
    const feedback = document.getElementById('turnstile-global-feedback');
    if (!shell || !feedback) {
      return;
    }

    if (!siteKey) {
      setMessage(feedback, 'Turnstile is not configured on this server.');
      return;
    }

    const renderWidget = function () {
      if (turnstileWidgetId !== undefined) {
        return;
      }
      turnstileWidgetId = window.turnstile.render(shell, {
        sitekey: siteKey,
        theme: 'light',
        callback: async (token) => {
          try {
            const data = await postJson('/api/turnstile/session', { turnstileToken: token });
            if (data.bypass) {
              turnstileSessionToken = '';
              turnstileSessionExpiresAt = Number.MAX_SAFE_INTEGER;
              setMessage(feedback, 'Verification is bypassed for this environment.', 'success');
              return;
            }
            turnstileSessionToken = data.turnstile_session_token;
            turnstileSessionExpiresAt = Date.now() + Number(data.expires_in_ms || 0);
            setMessage(feedback, 'Verification complete. You can now use all forms.', 'success');
          } catch (error) {
            turnstileSessionToken = '';
            turnstileSessionExpiresAt = 0;
            setMessage(feedback, error.message, 'error');
          }
        },
        'expired-callback': () => {
          turnstileSessionToken = '';
          turnstileSessionExpiresAt = 0;
          setMessage(feedback, 'Verification expired. Please verify again.', 'error');
        },
        'error-callback': () => {
          turnstileSessionToken = '';
          turnstileSessionExpiresAt = 0;
          setMessage(feedback, 'Verification failed. Please retry.', 'error');
        }
      });
      setMessage(feedback, 'Complete verification once to unlock all forms.');
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
    if (turnstileWidgetId !== undefined && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
    const feedback = document.getElementById('turnstile-global-feedback');
    if (feedback) {
      setMessage(feedback, 'Verification reset. Please verify again.');
    }
  }

  function initTabs() {
    const buttons = document.querySelectorAll('[data-tab-target]');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.tabTarget;
        document.querySelectorAll('.tab-button').forEach((item) => {
          item.classList.toggle('is-active', item === button);
          item.setAttribute('aria-selected', item === button ? 'true' : 'false');
        });
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          const active = panel.id === target;
          panel.classList.toggle('is-active', active);
          panel.hidden = !active;
        });
      });
    });
  }

  function setCodewordList(items) {
    const list = document.getElementById('user-codeword-list');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('li');
      row.innerHTML = `<strong>${item.codeword}</strong> — ${item.is_active ? 'active' : 'disabled'} | checked: ${item.last_checked_at || 'never'} | burn viewed: ${item.last_burn_viewed_at || 'never'}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = item.is_active ? 'destructive-button' : 'primary-button';
      button.textContent = item.is_active ? 'Disable' : 'Enable';
      button.addEventListener('click', async () => {
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
      row.appendChild(document.createTextNode(' '));
      row.appendChild(button);
      list.appendChild(row);
    });
  }

  function applyUserDashboard(data) {
    const dashboard = document.getElementById('user-dashboard');
    const adminDashboard = document.getElementById('admin-dashboard');
    show(adminDashboard, false);
    show(dashboard, true);

    const userStats = (data.dashboard && data.dashboard.user) || {};
    const stats = userStats.private_stats || {};
    const usernameNode = dashboard.querySelector('[data-user="username"]');
    if (usernameNode) {
      usernameNode.textContent = currentSession.username;
    }
    const lastViewer = dashboard.querySelector('[data-user="lastViewerAccess"]');
    if (lastViewer) {
      lastViewer.textContent = stats.last_viewer_access || 'Never';
    }
    const viewed = dashboard.querySelector('[data-user="messageViewed"]');
    if (viewed) {
      viewed.textContent = stats.message_viewed_flag ? 'Viewed' : 'Not viewed';
    }
    const twofaForm = document.getElementById('user-twofa-form');
    if (twofaForm) {
      twofaForm.elements.email.value = userStats.email || '';
      twofaForm.elements.enabled.checked = Boolean(userStats.twofa_enabled);
    }
    setCodewordList(userStats.codewords || []);
  }

  function applyAdminDashboard(data) {
    const dashboard = document.getElementById('admin-dashboard');
    const userDashboard = document.getElementById('user-dashboard');
    show(userDashboard, false);
    show(dashboard, true);

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
  }

  async function fetchRegisterSuggestion(form) {
    const data = await postJson('/api/register/suggest', attachTurnstileSession({}));
    return data.username;
  }

  function initHome() {
    initTabs();

    const sendPingForm = document.getElementById('send-ping-form');
    const sendPingFeedback = document.getElementById('send-ping-feedback');
    const registerForm = document.getElementById('register-form');
    const registerFeedback = document.getElementById('register-feedback');
    const registerUsername = document.getElementById('register-username');
    const regenerateUsernameLink = document.getElementById('regenerate-username-link');
    const regenerateCodewordLink = document.getElementById('regenerate-codeword-link');
    const userCodewordCreateForm = document.getElementById('user-codeword-create-form');
    const loginForm = document.getElementById('login-form');
    const login2faForm = document.getElementById('login-2fa-form');
    const loginFeedback = document.getElementById('login-feedback');
    const resetRequestForm = document.getElementById('password-reset-request-form');
    const resetConfirmForm = document.getElementById('password-reset-confirm-form');
    const checkPingForm = document.getElementById('check-ping-form');
    const checkPingFeedback = document.getElementById('check-ping-feedback');

    const pingerDashboard = document.getElementById('pinger-dashboard');
    const pingerRevealButton = document.getElementById('pinger-reveal-message');
    const pingerMessage = document.getElementById('pinger-message');
    const pingerLogout = document.getElementById('pinger-logout');
    const pingerShareSite = document.getElementById('pinger-share-site');

    const userDashboardFeedback = document.getElementById('user-dashboard-feedback');
    const adminDashboardFeedback = document.getElementById('admin-dashboard-feedback');

    const burnInput = document.getElementById('burn-message-input');
    const burnCharCount = document.getElementById('burn-char-count');
    if (burnInput && burnCharCount) {
      burnInput.addEventListener('input', () => {
        const remaining = 100 - burnInput.value.length;
        burnCharCount.textContent = remaining + ' characters remaining';
        burnCharCount.classList.toggle('near-limit', remaining <= 20);
      });
    }

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

    if (registerForm) {
      const suggest = async () => {
        try {
          setBusy(registerForm, true);
          const username = await fetchRegisterSuggestion(registerForm);
          registerUsername.value = username;
        } catch (error) {
          setMessage(registerFeedback, error.message, 'error');
        } finally {
          setBusy(registerForm, false);
        }
      };
      suggest();
      regenerateUsernameLink?.addEventListener('click', (event) => {
        event.preventDefault();
        suggest();
      });

      registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(registerFeedback, 'Registering…');
        setBusy(registerForm, true);
        try {
          const payload = attachTurnstileSession(formPayload(registerForm));
          const data = await postJson('/api/register', payload);
          setMessage(registerFeedback, `Registered as ${data.username}. First codeword: ${data.codeword}`, 'success');
          registerForm.reset();
          registerUsername.value = data.username;
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

    document.querySelectorAll('[data-status-value]').forEach((button) => {
      button.addEventListener('click', async () => {
        sendPingForm.elements.status.value = button.dataset.statusValue;
        setMessage(sendPingFeedback, 'Saving status…');
        setBusy(sendPingForm, true);
        try {
          const payload = attachTurnstileSession(formPayload(sendPingForm));
          const result = await postJson('/api/send-ping', payload);
          setMessage(
            sendPingFeedback,
            `Saved. Last checked: ${result.private_stats.last_viewer_access}. Burn message viewed: ${result.private_stats.message_viewed_flag ? 'yes' : 'no'}.`,
            'success'
          );
          sendPingForm.reset();
          if (burnCharCount) {
            burnCharCount.textContent = '100 characters remaining';
            burnCharCount.classList.remove('near-limit');
          }
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

    loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(loginForm, true);
      setMessage(loginFeedback, 'Signing in…');
      try {
        const payload = attachTurnstileSession(formPayload(loginForm));
        const data = await postJson('/api/login/start', payload);
        if (data.requires_2fa) {
          show(login2faForm, true);
          login2faForm.elements.challengeId.value = data.challenge_id;
          setMessage(loginFeedback, '2FA code sent. Enter it below.', 'success');
          return;
        }
        currentSession = {
          sessionToken: data.session_token,
          role: data.role,
          username: payload.username
        };
        if (data.role === 'admin') {
          applyAdminDashboard(data);
        } else {
          applyUserDashboard(data);
          refreshUserCodeword();
        }
        setMessage(loginFeedback, 'Logged in.', 'success');
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
        const payload = attachTurnstileSession(formPayload(login2faForm));
        const data = await postJson('/api/login/verify-2fa', payload);
        currentSession = {
          sessionToken: data.session_token,
          role: data.role,
          username: loginForm.elements.username.value
        };
        show(login2faForm, false);
        if (data.role === 'admin') {
          applyAdminDashboard(data);
        } else {
          applyUserDashboard(data);
          refreshUserCodeword();
        }
        setMessage(loginFeedback, 'Logged in.', 'success');
      } catch (error) {
        setMessage(loginFeedback, error.message, 'error');
        if (siteKey) {
          resetTurnstileSession();
        }
      } finally {
        setBusy(login2faForm, false);
      }
    });

    resetRequestForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(resetRequestForm, true);
      setMessage(loginFeedback, 'Sending reset code…');
      try {
        const payload = attachTurnstileSession(formPayload(resetRequestForm));
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
        setBusy(resetRequestForm, false);
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

    checkPingForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(checkPingForm, true);
      setMessage(checkPingFeedback, 'Checking status…');
      try {
        const payload = attachTurnstileSession(formPayload(checkPingForm));
        const data = await postJson('/api/check-ping', payload);
        pingerSession = {
          sessionToken: data.session_token,
          username: payload.username
        };
        pingerDashboard.querySelector('[data-pinger="username"]').textContent = payload.username;
        const statusPill = pingerDashboard.querySelector('[data-pinger="status"]');
        statusPill.textContent = data.status ? '🟢 OK' : '🔴 Not OK';
        statusPill.dataset.state = data.status ? 'ok' : 'not-ok';
        pingerDashboard.querySelector('[data-pinger="lastUpdated"]').textContent = data.last_status_update;
        show(pingerRevealButton, data.has_message);
        show(pingerMessage, false);
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

    pingerLogout?.addEventListener('click', async () => {
      await logoutAll();
      setMessage(checkPingFeedback, 'Logged out.', 'success');
    });

    pingerShareSite?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(window.location.origin).catch(() => {});
      setMessage(checkPingFeedback, 'Site link copied.', 'success');
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
        await postJson('/api/user/twofa', {
          sessionToken: currentSession.sessionToken,
          email: payload.email,
          enabled: payload.enabled === 'on'
        });
        setMessage(userDashboardFeedback, '2FA settings updated.', 'success');
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    userCodewordCreateForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentSession) {
        return;
      }
      const form = event.currentTarget;
      setBusy(form, true);
      try {
        const payload = formPayload(form);
        const data = await postJson('/api/user/codewords/create', {
          sessionToken: currentSession.sessionToken,
          codeword: payload.codeword
        });
        setCodewordList(data.codewords || []);
        refreshUserCodeword();
        setMessage(userDashboardFeedback, 'Codeword created.', 'success');
      } catch (error) {
        setMessage(userDashboardFeedback, error.message, 'error');
      } finally {
        setBusy(form, false);
      }
    });

    regenerateCodewordLink?.addEventListener('click', (event) => {
      event.preventDefault();
      refreshUserCodeword();
    });

    document.getElementById('user-share-link')?.addEventListener('click', () => {
      if (!currentSession) {
        return;
      }
      const link = `${window.location.origin}/?tab=check&user=${encodeURIComponent(currentSession.username)}`;
      navigator.clipboard.writeText(link).catch(() => {});
      const result = document.getElementById('user-share-result');
      if (result) {
        result.textContent = `Share link copied: ${link}`;
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

  mountTurnstile();

  if (view === 'home') {
    initHome();
  }
}());
