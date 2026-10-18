// src/app.js
//
// Exports a FACTORY, not a ready-made app instance.
//
// Why: tests/e2e.test.js and scripts/repro-concurrency.js both do
//     const createApp = require('../src/app');
//     const app = createApp();
// A module-level singleton would (a) share one rate-limiter Map across every
// boot, and (b) build the middleware stack before the caller has had a chance
// to point DATABASE_URL at a throwaway database. server.js is the entry point
// that calls createApp() and listens.
const path = require('path');
const express = require('express');
const cors = require('cors');

const securityHeaders = require('./middleware/securityHeaders');
const rateLimit = require('./middleware/rateLimit');
const patientRoutes = require('./routes/patientRoutes');
const labRoutes = require('./routes/labRoutes');
const reportRoutes = require('./routes/reportRoutes');
const { reportCsp } = require('./middleware/securityHeaders');
const errorMiddleware = require('./middleware/errorMiddleware');

// Requests allowed per IP per window. The suite fires hundreds of requests
// from 127.0.0.1 in a few seconds, so the test ceiling is deliberately higher.
const MAX_REQ = process.env.NODE_ENV === 'test' ? 2000 : 300;

// Optional reverse-proxy support. Left OFF by default so that req.ip cannot be
// spoofed via a client-supplied X-Forwarded-For header (which would let an
// attacker evade the per-IP rate limiter). Enable it explicitly — e.g.
// TRUST_PROXY=1 — only when running behind a single trusted proxy such as nginx.
const TRUST_PROXY = process.env.TRUST_PROXY || '';

// ---------------------------------------------------------------------------
// CORS — an allow-list, never a wildcard.
//
// The previous `cors()` reflected EVERY origin, so any public website could
// drive this API from a visitor's browser. Auth is a Bearer token in a header
// (not a cookie), so an attacker still needs the token to read data — but a
// wildcard is needlessly permissive. We now allow only:
//   • requests with no Origin (same-origin, curl, native apps),
//   • file:// pages, whose Origin is the literal string "null",
//   • any localhost / loopback origin (local dev on any port),
//   • any origin listed in CORS_ORIGINS (comma-separated) for production.
// Credentials are disabled: the token travels in a header, never a cookie.
// ---------------------------------------------------------------------------
function buildCors() {
    const allowExtra = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const isLocalOrigin = (o) => {
        try {
            const host = new URL(o).hostname;
            return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]';
        } catch {
            return false;
        }
    };

    return cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true);            // same-origin / curl / native
            if (origin === 'null') return cb(null, true);  // file:// pages
            if (allowExtra.includes(origin) || isLocalOrigin(origin)) return cb(null, true);
            return cb(null, false);                        // unknown → no CORS headers
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: false,
    });
}

function createApp() {
    const app = express();

    // Never advertise the framework version.
    app.disable('x-powered-by');

    // Only honour X-Forwarded-* when explicitly told to (see TRUST_PROXY above).
    if (TRUST_PROXY) {
        app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
    }

    // Order matters: headers and CORS go first so that even rejected requests
    // (401 / 404 / 429) carry them; body parsing and throttling come next.
    app.use(securityHeaders);
    app.use(buildCors());
    app.use(express.json({ limit: '100kb' }));
    app.use(rateLimit({ windowMs: 60_000, max: MAX_REQ }));

    if (process.env.NODE_ENV !== 'test') {
        app.use((req, res, next) => {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
            next();
        });
    }

    // securityHeaders sends a JSON-only policy (`default-src 'none'`) to every
    // response. That is correct for the API. The one HTML endpoint — the
    // printable report — swaps in a relaxed policy via reportCsp in its route.

    // ---- Static frontend ----
    // securityHeaders' JSON-only CSP (default-src 'none') is correct for the API
    // but would block the frontend's own <link>/<script> tags, so we relax it
    // for non-API responses only (same idea as reportCsp). This MUST run BEFORE
    // express.static serves a file, because static ends the response without
    // calling next() — middleware placed after it never runs for files.
    app.use((req, res, next) => {
        if (!req.path.startsWith('/api')) {
            res.setHeader(
                'Content-Security-Policy',
                [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline'",
                    "style-src 'self' 'unsafe-inline'",
                    "font-src 'self' data:",
                    "img-src 'self' data:",
                    "frame-ancestors 'none'",
                    "base-uri 'none'",
                    "form-action 'none'",
                    "object-src 'none'",
                ].join('; ')
            );
        }
        next();
    });

    // Serve the frontend (index.html, pages/, assets/) so the app and the
    // printable reports can resolve /assets/img/logo.png and the SPA shell from
    // the same origin. This MUST sit BEFORE the /api/* routes: express.static
    // only answers when a file matches, otherwise it falls through to the API.
    // __dirname = backend/src → '..' = backend → '..' = project root → frontend.
    // Folder on disk is "frontend" (all lowercase) — verified.
    app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

    // ---- API ----
    // Health is unauthenticated so uptime checks work without the token.
    app.get('/api/health', (req, res) => {
        res.json({ success: true, data: { status: 'ok', time: new Date() } });
    });

    app.use('/api/patients', patientRoutes);
    app.use('/api', labRoutes);

    // The summary PRINT endpoint returns a full HTML document with an inline
    // <style> and a small inline print script. The global JSON-only CSP from
    // securityHeaders would block those, so we relax the policy on this path
    // up front (it only rewrites the CSP header; auth still happens in the
    // route). This must run BEFORE reportRoutes so the relaxed header is set
    // before the handler sends the response.
    app.use('/api/reports/summary/print', reportCsp);
    app.use('/api/reports', reportRoutes);

    // Unknown /api/* paths must answer as JSON, never fall through to static.
    app.use('/api', (req, res) => {
        res.status(404).json({ success: false, message: 'Route not found' });
    });

    // CSP relaxer is registered above (before static); /public assets next.
    // Serve backend public assets (e.g. /public/logo.png) at a distinct path so they
    // don't collide with frontend assets served at root.
    app.use('/public', express.static(path.join(__dirname, '..', 'public')));

    // Error handler must stay last: it only runs for errors passed to next().
    app.use(errorMiddleware);

    return app;
}

// Named export for convenience alongside the callable default.
module.exports = createApp;
module.exports.createApp = createApp;