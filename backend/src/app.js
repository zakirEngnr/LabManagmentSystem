
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


const MAX_REQ = process.env.NODE_ENV === 'test' ? 2000 : 300;

const TRUST_PROXY = process.env.TRUST_PROXY || '';


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


    app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

    // ---- API ----
    // Health is unauthenticated so uptime checks work without the token.
    app.get('/api/health', (req, res) => {
        res.json({ success: true, data: { status: 'ok', time: new Date() } });
    });

    app.use('/api/patients', patientRoutes);
    app.use('/api', labRoutes);


    app.use('/api/reports/summary/print', reportCsp);
    app.use('/api/reports', reportRoutes);

    // Unknown /api/* paths must answer as JSON, never fall through to static.
    app.use('/api', (req, res) => {
        res.status(404).json({ success: false, message: 'Route not found' });
    });

    app.use('/public', express.static(path.join(__dirname, '..', 'public')));

    app.use(errorMiddleware);

    return app;
}

module.exports = createApp;
module.exports.createApp = createApp;