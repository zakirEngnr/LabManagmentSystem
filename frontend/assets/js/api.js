
(function () {
    'use strict';

    if (window.api) return; 

    // ------------------------------------------------------------
    // CONFIG
    // ------------------------------------------------------------
    const DEFAULT_API_BASE = 'http://localhost:5000';


    const PERSIST_LOGIN = true;

    const TOKEN_KEY = 'lab_token';
    const DEFAULT_TIMEOUT_MS = 15000;
    const REPORT_TIMEOUT_MS = 30000;

    function resolveBase() {
        const raw = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || DEFAULT_API_BASE;
        let url;
        try {
            url = new URL(raw);
        } catch (_) {
            throw new Error('Invalid API base URL: ' + raw);
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('API base URL must be http or https');
        }
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol === 'http:' && !local) {
            // Patient data and the login token would travel in clear text.
        }
        return url.origin;
    }

    const API_BASE = resolveBase();

    // ------------------------------------------------------------
    // TOKEN MANAGEMENT
    // ------------------------------------------------------------
    // Storage can throw (private mode, blocked cookies), so every access is guarded.
    function store() {
        try {
            return PERSIST_LOGIN ? window.localStorage : window.sessionStorage;
        } catch (_) {
            return null;
        }
    }

    function getToken() {
        try {
            const s = store();
            return (s && s.getItem(TOKEN_KEY)) || '';
        } catch (_) {
            return '';
        }
    }

    function setToken(token) {
        if (typeof token !== 'string' || !token || token.length > 4096 || /\s/.test(token)) {
            throw new TypeError('Invalid token');
        }
        const s = store();
        if (!s) throw new Error('Browser storage is unavailable, cannot stay logged in.');
        s.setItem(TOKEN_KEY, token);
    }

    function clearToken() {
        try {
            const s = store();
            if (s) s.removeItem(TOKEN_KEY);
            // Also clear the other storage in case the setting changed.
            window.localStorage.removeItem(TOKEN_KEY);
            window.sessionStorage.removeItem(TOKEN_KEY);
        } catch (_) { /* ignore */ }
    }

    // ------------------------------------------------------------
    // LOGIN REDIRECT (runs once, even if several requests fail together)
    // ------------------------------------------------------------
    let redirecting = false;

    function onLoginPage() {
        return window.location.pathname.includes('login.html');
    }

    function goToLogin() {
        clearToken();
        if (redirecting || onLoginPage()) return;
        redirecting = true;
        window.location.href = window.location.pathname.includes('/pages/')
            ? './login.html'
            : './pages/login.html';
    }

    function logout() {
        goToLogin();
    }

    // Validation helpers reject with the SAME status the server would return,
    // so callers can branch on `err.status` uniformly instead of having to
    // special-case client-side rejections.
    function badRequest(message) {
        return makeError(message, 400);
    }

    // ------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------
    // Build exactly one URL path segment from an id.
    //
    // ALLOW-LIST, not a block-list: every id this API issues is either a
    // human code (PT-1001, LV-1001) or a Prisma cuid (lowercase alphanumeric,
    // e.g. "clv8xk2n40000l508abc1234"). None contain "/", "?", "#", ".",
    // whitespace or "%". Rejecting anything outside this set fails CLOSED, so a
    // new id format can never quietly produce a mangled URL — it throws here
    // instead. The previous version block-listed ".." and let "../../etc/passwd"
    // and "a/b" straight through.
    const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

    function seg(id) {
        if (typeof id !== 'string' && typeof id !== 'number') {
            throw new TypeError('Invalid id');
        }
        const s = String(id).trim();
        if (!ID_PATTERN.test(s)) {
            throw new TypeError('Invalid id');
        }
        // Unreachable for a matching id (no reserved chars survive the
        // allow-list), but kept so the encoder can never be dropped by mistake.
        return encodeURIComponent(s);
    }

    function makeError(message, status, extra) {
        const err = new Error(message);
        err.status = status;
        if (extra && extra.payload !== undefined) err.payload = extra.payload;
        if (extra && extra.cause) err.cause = extra.cause;
        return err;
    }

    // Only trust a short plain string from the server. Always render it with
    // textContent, never innerHTML.
    function messageFrom(payload, status) {
        const m = payload && typeof payload === 'object' ? payload.message : null;
        if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 300);
        if (status === 403) return 'You do not have permission to do this.';
        if (status === 404) return 'Not found.';
        if (status === 429) return 'Too many requests. Wait a moment and try again.';
        if (status >= 500) return 'Server error. Please try again.';
        return 'Request failed (HTTP ' + status + ').';
    }

    // Identical write requests that are still running share one result, so a
    // double-click on "Save" cannot create two patients or two visits.
    const inflight = new Map();

    // ------------------------------------------------------------
    // CORE FETCH WRAPPER
    // ------------------------------------------------------------
    // options: { method, body, auth = true, accept, timeout }
    function request(path, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        if (method === 'GET') return send(path, options, method);

        const key = method + ' ' + path + ' ' + (options.body === undefined ? '' : JSON.stringify(options.body));
        if (inflight.has(key)) return inflight.get(key);

        const p = send(path, options, method).finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
    }

    async function send(path, options, method) {
        const { body, auth = true, accept = 'application/json', timeout = DEFAULT_TIMEOUT_MS } = options;

        if (window.location.protocol === 'https:' && API_BASE.startsWith('http:')) {
            throw makeError('Blocked: this page is HTTPS but the API address is plain HTTP.', 0);
        }

        const headers = { Accept: accept };
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        if (auth) {
            const token = getToken();
            if (!token) {
                // Not logged in: do not send an empty "Bearer " header.
                goToLogin();
                throw makeError('Please log in.', 401);
            }
            headers.Authorization = 'Bearer ' + token;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        let res;
        try {
            res = await fetch(API_BASE + path, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
                credentials: 'omit',           // auth is the Bearer header only
                cache: 'no-store',             // never cache patient data
                referrerPolicy: 'no-referrer',
            });
        } catch (e) {
            clearTimeout(timer);
            if (e && e.name === 'AbortError') {
                throw makeError('The server took too long to respond. Please try again.', 0, { cause: e });
            }
            throw makeError('Cannot reach server. Is the backend running?', 0, { cause: e });
        }

        // --------------------------------------------------------
        // Read the body (JSON or text) while the timeout still applies
        // --------------------------------------------------------
        let payload = null;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                try { payload = await res.json(); } catch (_) { payload = null; }
            } else {
                payload = await res.text();
            }
        } catch (e) {
            clearTimeout(timer);
            throw makeError('Connection lost while reading the response.', 0, { cause: e });
        }
        clearTimeout(timer);

        // --------------------------------------------------------
        // 401 — token missing, wrong or expired
        // --------------------------------------------------------
        if (res.status === 401 && auth) {
            goToLogin();
            throw makeError('Session expired. Please log in again.', 401);
        }

        // --------------------------------------------------------
        // Other errors
        // --------------------------------------------------------
        if (!res.ok) {
            throw makeError(messageFrom(payload, res.status), res.status, { payload });
        }

        // --------------------------------------------------------
        // Success — unwrap { success: true, data }
        // --------------------------------------------------------
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
            return payload.data;
        }
        return payload;
    }

    async function openReport(id) {
        const idPart = seg(id); // validate before opening any window

        const win = window.open('', '_blank');
        if (!win) {
            throw makeError('Popup blocked. Allow popups for this site to open reports.', 0);
        }
        try { win.opener = null; } catch (_) { /* ignore */ }
        try { win.document.title = 'Loading report…'; } catch (_) { /* ignore */ }

        try {
            const html = await request('/api/visits/' + idPart + '/report', {
                accept: 'text/html',
                timeout: REPORT_TIMEOUT_MS,
            });
            if (typeof html !== 'string' || !html.includes('<html')) {
                throw makeError('The server did not return a report.', 502);
            }
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            win.location.replace(url);
            setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
        } catch (e) {
            try { win.close(); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    // Dates must be strict YYYY-MM-DD (the backend validates the same way).
    const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

    function dateParam(name, value) {
        if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
            throw new TypeError('Invalid ' + name + ' date. Use YYYY-MM-DD.');
        }
        return encodeURIComponent(value);
    }

    // Opens the printable period-summary report in a new tab, exactly like
    // openReport(): fetch HTML, hand it to a popup via a Blob URL, then revoke.
    async function openSummaryReport(from, to) {
        const query = '?from=' + dateParam('from', from) + '&to=' + dateParam('to', to);

        const win = window.open('', '_blank');
        if (!win) {
            throw makeError('Popup blocked. Allow popups for this site to open reports.', 0);
        }
        try { win.opener = null; } catch (_) { /* ignore */ }
        try { win.document.title = 'Loading report…'; } catch (_) { /* ignore */ }

        try {
            const html = await request('/api/reports/summary/print' + query, {
                accept: 'text/html',
                timeout: REPORT_TIMEOUT_MS,
            });
            if (typeof html !== 'string' || !html.includes('<html')) {
                throw makeError('The server did not return a report.', 502);
            }
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            win.location.replace(url);
            setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
        } catch (e) {
            try { win.close(); } catch (_) { /* ignore */ }
            throw e;
        }
    }

    // ------------------------------------------------------------
    // HIGH-LEVEL API
    // ------------------------------------------------------------
    const PAYMENT_STATUSES = ['Paid', 'Unpaid'];

    const api = {
        // ---- Auth ----
        auth: {
            setToken,
            logout,
            isLoggedIn: () => !!getToken(),
        },

        // ---- Patients ----
        // NOTE: /api/patients/:id looks up the INTERNAL cuid, not the human
        // PT-1001 code (the backend does `where: { id: req.params.id }`).
        // patients.list() returns both `id` and `patientId`; pass `id` here.
        // Passing a PT- code returns 404 "Patient not found".
        patients: {
            list:   ()     => request('/api/patients'),
            get: async (id) => {
                const raw = String(id || '').trim();
                try {
                    return await request('/api/patients/' + seg(raw));
                } catch (err) {
                    if (!err || err.status !== 404 || !/^PT-\d+$/i.test(raw)) throw err;
                    const list = await request('/api/patients');
                    const match = Array.isArray(list) ? list.find((p) => p.patientId === raw) : null;
                    if (!match) throw err;
                    return await request('/api/patients/' + seg(match.id));
                }
            },
            create: (data) => request('/api/patients', { method: 'POST', body: data }),
        },

        // ---- Test catalog ----
        tests: {
            list: () => request('/api/tests'),
        },

        // ---- Visits ----
        visits: {
            list:   ()     => request('/api/visits'),
            get:    (id)   => request('/api/visits/' + seg(id)),
            create: (data) => request('/api/visits', { method: 'POST', body: data }),
            markPaid: (id, status) => {
                if (!PAYMENT_STATUSES.includes(status)) {
                    return Promise.reject(badRequest('status must be "Paid" or "Unpaid"'));
                }
                return request('/api/visits/' + seg(id) + '/payment', {
                    method: 'PUT',
                    body: { paymentStatus: status },
                });
            },
            record: (recordId) => request('/api/visits/records/' + seg(recordId)),
            saveResults: (recordId, values) => {
                if (!Array.isArray(values)) {
                    return Promise.reject(badRequest('values must be an array'));
                }
                return request('/api/visits/records/' + seg(recordId) + '/results', {
                    method: 'PUT',
                    body: { values },
                });
            },
            openReport,
        },

        // ---- Health (public: no token, never redirects to login) ----
        health: () => request('/api/health', { auth: false }),

        // ---- Period reports (daily / weekly / monthly / custom) ----
        reports: {
            // JSON summary for an inclusive YYYY-MM-DD range.
            summary: (from, to) => request(
                '/api/reports/summary?from=' + dateParam('from', from) + '&to=' + dateParam('to', to)
            ),
            // Printable HTML report for the same range (opens a new tab).
            openPrint: (from, to) => openSummaryReport(from, to),
        },
    };


    Object.freeze(api.auth);
    Object.freeze(api.patients);
    Object.freeze(api.tests);
    Object.freeze(api.visits);
    Object.freeze(api.reports);
    Object.freeze(api);
    Object.defineProperty(window, 'api', {
        value: api,
        writable: false,
        configurable: false,
        enumerable: true,
    });
})();