(function () {
  const view = document.body.dataset.view;
  const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content || '';
  const viewerUsername = document.querySelector('meta[name="viewer-username"]')?.content || '';
  const widgetMap = new Map();
  let adminSession = null;
  let viewerSession = null;

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

  function scrollIntoView(element) {
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Disable (busy=true) or re-enable (busy=false) every button inside a form.
   * Used to prevent double-submission while an async request is in flight.
   */
  function setBusy(form, busy) {
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
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({ ok: false, error: 'Unexpected response' }));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  function mountTurnstile() {
    const shells = document.querySelectorAll('.js-turnstile');
    if (!shells.length) {
      return;
    }

    if (!siteKey) {
      shells.forEach((shell) => {
        shell.textContent = 'Turnstile is not configured on this server.';
      });
      return;
    }

    const renderWidgets = function () {
      shells.forEach((shell) => {
        if (widgetMap.has(shell.closest('form'))) {
          return;
        }

        const widgetId = window.turnstile.render(shell, {
          sitekey: siteKey,
          theme: 'light'
        });
        widgetMap.set(shell.closest('form'), widgetId);
      });
    };

    if (window.turnstile) {
      renderWidgets();
      return;
    }

    window.addEventListener('load', renderWidgets, { once: true });
  }

  function tokenFor(form) {
    const widgetId = widgetMap.get(form);
    if (!siteKey) {
      return '';
    }
    return widgetId !== undefined && window.turnstile ? window.turnstile.getResponse(widgetId) : '';
  }

  function resetTurnstile(form) {
    const widgetId = widgetMap.get(form);
    if (widgetId !== undefined && window.turnstile) {
      window.turnstile.reset(widgetId);
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

  function initHome() {
    initTabs();
    const statusForm = document.getElementById('status-form');
    const deleteForm = document.getElementById('delete-form');
    const statusFeedback = document.getElementById('status-feedback');
    const deleteFeedback = document.getElementById('delete-feedback');
    const privateStats = document.getElementById('private-stats');

    // Character counter for the burn message textarea
    const burnInput = document.getElementById('burn-message-input');
    const burnCharCount = document.getElementById('burn-char-count');
    const BURN_MAX = 100;
    if (burnInput && burnCharCount) {
      burnInput.addEventListener('input', () => {
        const remaining = BURN_MAX - burnInput.value.length;
        burnCharCount.textContent = remaining + ' characters remaining';
        burnCharCount.classList.toggle('near-limit', remaining <= 20);
      });
    }

    // Delete form: confirmation checkbox gates the submit button
    const deleteConfirmCheck = document.getElementById('delete-confirm-check');
    const deleteSubmitBtn = document.getElementById('delete-submit-btn');
    if (deleteConfirmCheck && deleteSubmitBtn) {
      deleteConfirmCheck.addEventListener('change', () => {
        deleteSubmitBtn.disabled = !deleteConfirmCheck.checked;
      });
    }

    document.querySelectorAll('[data-status-value]').forEach((button) => {
      button.addEventListener('click', async () => {
        const status = button.dataset.statusValue;
        statusForm.elements.status.value = status;
        setMessage(statusFeedback, 'Submitting\u2026');
        setBusy(statusForm, true);

        try {
          const payload = formPayload(statusForm);
          payload.turnstileToken = tokenFor(statusForm);
          const result = await postJson('/api/status', payload);
          const stats = result.private_stats;
          privateStats.querySelector('[data-stat="lastViewerAccess"]').textContent = stats.last_viewer_access;
          privateStats.querySelector('[data-stat="messageViewedFlag"]').textContent = stats.message_viewed_flag ? 'Viewed' : 'Not viewed';
          show(privateStats, true);
          scrollIntoView(privateStats);
          setMessage(statusFeedback, 'Status saved.', 'success');
          statusForm.reset();
          if (burnCharCount) {
            burnCharCount.textContent = BURN_MAX + ' characters remaining';
            burnCharCount.classList.remove('near-limit');
          }
        } catch (error) {
          setMessage(statusFeedback, error.message, 'error');
        } finally {
          setBusy(statusForm, false);
          resetTurnstile(statusForm);
        }
      });
    });

    deleteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setMessage(deleteFeedback, 'Deleting\u2026');
      setBusy(deleteForm, true);
      try {
        const payload = formPayload(deleteForm);
        payload.turnstileToken = tokenFor(deleteForm);
        await postJson('/api/delete-account', payload);
        deleteForm.reset();
        show(privateStats, false);
        setMessage(deleteFeedback, 'Account deleted.', 'success');
      } catch (error) {
        setMessage(deleteFeedback, error.message, 'error');
      } finally {
        setBusy(deleteForm, false);
        // Keep the submit button disabled — checkbox was reset by form.reset()
        if (deleteSubmitBtn) {
          deleteSubmitBtn.disabled = !(deleteConfirmCheck && deleteConfirmCheck.checked);
        }
        resetTurnstile(deleteForm);
      }
    });
  }

  function initViewer() {
    const accessForm = document.getElementById('viewer-access-form');
    const feedback = document.getElementById('viewer-feedback');
    const result = document.getElementById('viewer-result');
    const statusPill = document.getElementById('viewer-status-pill');
    const lastUpdated = document.getElementById('viewer-last-updated');
    const revealButton = document.getElementById('reveal-message-button');
    const revealedMessage = document.getElementById('revealed-message');
    const acknowledgeButton = document.getElementById('acknowledge-button');

    accessForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setMessage(feedback, 'Checking codeword\u2026');
      setBusy(accessForm, true);
      try {
        const payload = formPayload(accessForm);
        payload.username = viewerUsername;
        payload.turnstileToken = tokenFor(accessForm);
        const data = await postJson('/api/viewer/access', payload);
        viewerSession = { codeword: payload.codeword };
        statusPill.textContent = data.status ? '\uD83D\uDFE2 OK' : '\uD83D\uDD34 Not OK';
        statusPill.dataset.state = data.status ? 'ok' : 'not-ok';
        lastUpdated.textContent = data.last_status_update;
        show(result, true);
        scrollIntoView(result);
        show(revealButton, data.has_message);
        show(revealedMessage, false);
        show(acknowledgeButton, false);
        if (!data.has_message) {
          setMessage(feedback, 'No private message is queued for this status.', 'success');
        } else {
          setMessage(feedback, 'Status unlocked.', 'success');
        }
      } catch (error) {
        setMessage(feedback, error.message, 'error');
      } finally {
        setBusy(accessForm, false);
        resetTurnstile(accessForm);
      }
    });

    revealButton.addEventListener('click', async () => {
      if (!viewerSession) {
        setMessage(feedback, 'Unlock the page first.', 'error');
        return;
      }
      setMessage(feedback, 'Revealing message\u2026');
      revealButton.disabled = true;
      try {
        const data = await postJson('/api/viewer/reveal', {
          username: viewerUsername,
          codeword: viewerSession.codeword
        });
        revealedMessage.textContent = data.message || 'This message has already been cleared.';
        show(revealedMessage, true);
        show(revealButton, false);
        show(acknowledgeButton, true);
        scrollIntoView(acknowledgeButton);
        setMessage(feedback, 'Message opened. It has now been removed from the server.', 'success');
      } catch (error) {
        revealButton.disabled = false;
        setMessage(feedback, error.message, 'error');
      }
    });

    acknowledgeButton.addEventListener('click', async () => {
      if (!viewerSession) {
        return;
      }
      setMessage(feedback, 'Sending acknowledgement\u2026');
      acknowledgeButton.disabled = true;
      try {
        const data = await postJson('/api/viewer/acknowledge', {
          username: viewerUsername,
          codeword: viewerSession.codeword
        });
        setMessage(feedback, data.mailed ? 'Acknowledgement sent.' : 'Acknowledged. No alert email was configured.', 'success');
      } catch (error) {
        acknowledgeButton.disabled = false;
        setMessage(feedback, error.message, 'error');
      }
    });
  }

  function initAdmin() {
    const loginForm = document.getElementById('admin-login-form');
    const resetForm = document.getElementById('admin-reset-form');
    const feedback = document.getElementById('admin-feedback');
    const dashboard = document.getElementById('admin-dashboard');
    const totalUsers = document.getElementById('total-users');

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setMessage(feedback, 'Signing in\u2026');
      setBusy(loginForm, true);
      try {
        const payload = formPayload(loginForm);
        payload.turnstileToken = tokenFor(loginForm);
        const data = await postJson('/api/admin/login', payload);
        adminSession = payload;
        resetTurnstile(loginForm);
        if (data.reset_required) {
          show(resetForm, true);
          show(dashboard, false);
          scrollIntoView(resetForm);
          setMessage(feedback, 'First login detected. Set a new admin password now.', 'success');
          return;
        }
        totalUsers.textContent = String(data.total_users);
        show(dashboard, true);
        show(resetForm, false);
        scrollIntoView(dashboard);
        setMessage(feedback, 'Signed in.', 'success');
      } catch (error) {
        resetTurnstile(loginForm);
        setMessage(feedback, error.message, 'error');
      } finally {
        setBusy(loginForm, false);
      }
    });

    resetForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!adminSession) {
        setMessage(feedback, 'Sign in first.', 'error');
        return;
      }
      setMessage(feedback, 'Saving new admin password\u2026');
      setBusy(resetForm, true);
      try {
        const payload = formPayload(resetForm);
        payload.username = adminSession.username;
        payload.password = adminSession.password;
        payload.turnstileToken = tokenFor(resetForm);
        const data = await postJson('/api/admin/reset', payload);
        totalUsers.textContent = String(data.total_users);
        show(dashboard, true);
        show(resetForm, false);
        resetForm.reset();
        scrollIntoView(dashboard);
        setMessage(feedback, 'Admin password updated.', 'success');
      } catch (error) {
        setMessage(feedback, error.message, 'error');
      } finally {
        setBusy(resetForm, false);
        resetTurnstile(resetForm);
      }
    });
  }

  mountTurnstile();

  if (view === 'home') {
    initHome();
  } else if (view === 'viewer') {
    initViewer();
  } else if (view === 'admin') {
    initAdmin();
  }
}());
