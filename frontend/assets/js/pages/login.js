// ============================================================
// assets/js/pages/login.js
// Login page: read token, validate, store, redirect to dashboard.
// ============================================================

(function () {
    'use strict';

    // ------------------------------------------------------------
    // If already logged in, go straight to the dashboard.
    // ------------------------------------------------------------
    if (auth.isLoggedIn()) {
        auth.redirectToDashboard();
        return;
    }

    // ------------------------------------------------------------
    // Show "reason" message if redirected here (e.g. session expired)
    // ------------------------------------------------------------
    (function showReason() {
        let reason = '';
        try { reason = sessionStorage.getItem('login_reason') || ''; } catch (_) {}
        if (!reason) return;
        const el = document.getElementById('reasonText');
        if (el) el.textContent = reason;
        try { sessionStorage.removeItem('login_reason'); } catch (_) {}
    })();

    // ------------------------------------------------------------
    // Handle form submit
    // ------------------------------------------------------------
    const form = document.getElementById('loginForm');
    const input = document.getElementById('tokenInput');
    const btn   = document.getElementById('loginBtn');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const token = (input.value || '').trim();

        if (!token) {
            ui.toast('Please enter your access token', 'error');
            input.focus();
            return;
        }

        // Basic sanity check — the backend requires min 16 chars
        if (token.length < 16) {
            ui.toast('That token looks too short. Check it and try again.', 'error');
            input.focus();
            return;
        }

        ui.setLoading(btn, true);

        try {
            // auth.login() saves the token, then pings /api/patients
            // to confirm the backend accepts it.
            await auth.login(token);

            ui.toast('Signed in successfully', 'success');

            // Small delay so the toast is visible before we leave
            setTimeout(() => auth.redirectToDashboard(), 350);

        } catch (err) {
            ui.setLoading(btn, false);

            if (err && err.status === 401) {
                ui.toast('Invalid token. Please check and try again.', 'error');
            } else if (err && err.status === 0) {
                ui.toast('Cannot reach the server. Is the backend running?', 'error');
            } else {
                ui.toast(err.message || 'Sign in failed', 'error');
            }

            input.select();
            input.focus();
        }
    });

    // ------------------------------------------------------------
    // Auto-focus the input on load
    // ------------------------------------------------------------
    input.focus();

    // ------------------------------------------------------------
    // Allow pasting from clipboard with Ctrl+V even before focus
    // ------------------------------------------------------------
    document.addEventListener('paste', (e) => {
        if (document.activeElement === input) return;
        // window.clipboardData is IE-only; in modern browsers clipboardData
        // is on the event. If neither exists, there is nothing to read.
        const cd = e.clipboardData || window.clipboardData;
        if (!cd) return;
        const text = cd.getData('text');
        if (text) {
            input.value = text.trim();
            e.preventDefault();
        }
    });
})();