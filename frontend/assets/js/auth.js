

(function () {
    'use strict';

    if (window.auth) return; // already loaded

    const TOKEN_KEY = 'lab_token';

    // ------------------------------------------------------------
    // TOKEN HELPERS
    // ------------------------------------------------------------
    function getToken() {
        try {
            return localStorage.getItem(TOKEN_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function isLoggedIn() {
        const t = getToken();
        return typeof t === 'string' && t.length > 0;
    }

    function setToken(token) {
        if (typeof token !== 'string') {
            throw new TypeError('Token must be a string');
        }
        const trimmed = token.trim();
        if (!trimmed) {
            throw new Error('Token cannot be empty');
        }
        if (trimmed.length < 16) {
            throw new Error('Token looks too short — check your .env API_TOKEN');
        }
        localStorage.setItem(TOKEN_KEY, trimmed);
    }

    function clearToken() {
        try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
    }

    // ------------------------------------------------------------
    // WHERE AM I? (root index.html vs /pages/*.html)
    // ------------------------------------------------------------
    function isOnLoginPage() {
        return window.location.pathname.includes('login.html');
    }

    function isOnPagesFolder() {
        return window.location.pathname.includes('/pages/');
    }

    function loginPath() {
        return isOnPagesFolder() ? './login.html' : './pages/login.html';
    }

    function dashboardPath() {
        return isOnPagesFolder() ? '../index.html' : './index.html';
    }

    // ------------------------------------------------------------
    // REDIRECTS
    // ------------------------------------------------------------
    function redirectToLogin(reason) {
        // Avoid loops
        if (isOnLoginPage()) return;

        // One-time flag so the login page can show a friendly message
        if (reason) {
            try { sessionStorage.setItem('login_reason', reason); } catch (_) {}
        }
        window.location.replace(loginPath());
    }

    function redirectToDashboard() {
        window.location.replace(dashboardPath());
    }

    // ------------------------------------------------------------
    // GUARD — runs immediately on protected pages
    // ------------------------------------------------------------
    function guard() {
        if (isOnLoginPage()) return;           // login page handles itself
        if (!isLoggedIn()) {
            redirectToLogin('Your session expired. Please log in.');
        }
    }

    // Run the guard immediately (before page scripts execute)
    guard();

    // ------------------------------------------------------------
    // LOGIN PAGE API
    // ------------------------------------------------------------
    async function login(token) {
        // Validate the token by calling a lightweight endpoint.
        setToken(token);

        try {
            // /api/health is public but tells us the server is up.
            // Then we hit a protected endpoint to confirm the token works.
            await api.patients.list();
            return true;
        } catch (err) {
            // Wrong token → clear it and re-throw
            if (err && (err.status === 401 || err.status === 0)) {
                clearToken();
                throw err;
            }
            throw err;
        }
    }

    function logout() {
        clearToken();
        redirectToLogin('You have been logged out.');
    }

    // ------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------
    const auth = {
        isLoggedIn,
        getToken,
        setToken,
        clearToken,
        login,
        logout,
        redirectToLogin,
        redirectToDashboard,
        isOnLoginPage,
        isOnPagesFolder,
    };

    Object.freeze(auth);
    Object.defineProperty(window, 'auth', {
        value: auth,
        writable: false,
        configurable: false,
        enumerable: true,
    });
})();