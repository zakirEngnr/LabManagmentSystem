
const crypto = require('crypto');
const { error } = require('../utils/apiResponse');

function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));

    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

function requireAuth(req, res, next) {
    const expected = process.env.API_TOKEN;

    if (!expected || expected.length < 16) {
        console.error(
            '[auth] API_TOKEN is missing or too short (min 16 chars) — ' +
                'refusing all authenticated requests.'
        );
        return error(res, 'Server authentication is not configured', 500);
    }

    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token || !safeEqual(token, expected)) {
        return error(res, 'Unauthorized', 401);
    }

    next();
}

module.exports = requireAuth;
