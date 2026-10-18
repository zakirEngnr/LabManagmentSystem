// ============================================================
// assets/js/ui.js
// Shared UI helpers: toast, modal, escapeHtml, formatters,
// badge helpers, clock, query string.
//
// Load AFTER api.js. Every page uses these.
//
// Usage:
//   ui.toast('Saved!', 'success');
//   ui.openModal('modalId');
//   ui.fmtMoney(1200)          → "Rs. 1,200"
//   ui.paymentBadge('Paid')    → '<span class="badge badge-paid">Paid</span>'
// ============================================================

(function () {
    'use strict';

    if (window.ui) return; // already loaded

    // ------------------------------------------------------------
    // TOAST
    // ------------------------------------------------------------
    function ensureToastContainer() {
        let el = document.getElementById('toastContainer');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toastContainer';
            el.className = 'toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    function toast(message, type = '') {
        const container = ensureToastContainer();
        const el = document.createElement('div');
        el.className = 'toast' + (type ? ' ' + type : '');
        el.textContent = String(message || ''); // textContent → no XSS
        container.appendChild(el);

        setTimeout(() => {
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 300);
        }, 2800);
    }

    // ------------------------------------------------------------
    // MODAL
    // ------------------------------------------------------------
    function openModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }

    // Close on overlay click (but not on inner card click)
    document.addEventListener('click', (e) => {
        if (e.target.classList && e.target.classList.contains('modal-overlay')) {
            e.target.classList.add('hidden');
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = document.querySelectorAll('.modal-overlay:not(.hidden)');
        open.forEach(m => m.classList.add('hidden'));
    });

    // ------------------------------------------------------------
    // HTML ESCAPE (defense-in-depth for user-supplied strings)
    // ------------------------------------------------------------
    // Always prefer textContent. When you must build an HTML string,
    // wrap any user value with this function.
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ------------------------------------------------------------
    // FORMATTERS
    // ------------------------------------------------------------
    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-GB'); // 12/10/2026
    }

    function fmtDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-GB') + ' ' +
            d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    function fmtTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    function fmtMoney(n) {
        const num = Number(n || 0);
        return 'Rs. ' + num.toLocaleString();
    }

    // ------------------------------------------------------------
    // BADGES
    // ------------------------------------------------------------
    function badge(text, kind) {
        return '<span class="badge badge-' + escapeHtml(kind) + '">' +
               escapeHtml(text) + '</span>';
    }

    function paymentBadge(status) {
        const kind = status === 'Paid' ? 'paid' : 'unpaid';
        return badge(status, kind);
    }

    function resultBadge(status) {
        const kind = status === 'Completed' ? 'completed' : 'pending';
        return badge(status, kind);
    }

    // ------------------------------------------------------------
    // BUTTON LOADING STATE
    // ------------------------------------------------------------
    // setLoading(btn, true)  → shows spinner, disables
    // setLoading(btn, false) → restores original content
    function setLoading(btn, loading) {
        if (!btn) return;
        if (loading) {
            if (!btn.dataset.originalText) {
                btn.dataset.originalText = btn.innerHTML;
            }
            btn.disabled = true;
            btn.innerHTML = '<span class="loading"></span> Please wait…';
        } else {
            btn.disabled = false;
            if (btn.dataset.originalText) {
                btn.innerHTML = btn.dataset.originalText;
                delete btn.dataset.originalText;
            }
        }
    }

    // ------------------------------------------------------------
    // TOPBAR CLOCK
    // ------------------------------------------------------------
    // Call once per page with the id of the clock element.
    //   ui.startClock('clock');
    function startClock(elementId = 'clock') {
        const el = document.getElementById(elementId);
        if (!el) return;
        const tick = () => {
            const d = new Date();
            el.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        };
        tick();
        return setInterval(tick, 1000);
    }

    // ------------------------------------------------------------
    // QUERY STRING PARSER (?id=xxx)
    // ------------------------------------------------------------
    function getQuery(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    }

    // ------------------------------------------------------------
    // EXPORT
    // ------------------------------------------------------------
    const ui = {
        toast,
        openModal,
        closeModal,
        escapeHtml,
        fmtDate,
        fmtDateTime,
        fmtTime,
        fmtMoney,
        badge,
        paymentBadge,
        resultBadge,
        setLoading,
        startClock,
        getQuery,
    };

    Object.freeze(ui);
    Object.defineProperty(window, 'ui', {
        value: ui,
        writable: false,
        configurable: false,
        enumerable: true,
    });

    // Convenience global
    window.toast = toast;
})();