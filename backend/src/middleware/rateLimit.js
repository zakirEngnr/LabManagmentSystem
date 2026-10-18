
function rateLimit({ windowMs = 60_000, max = 300 } = {}) {
    const hits = new Map();

    // Drop only ENTRIES whose own window has expired. Clearing the whole map
    // (the old behaviour) reset every IP's counter at the same instant, which
    // both erased honest in-window counts and let one IP burst up to 2×max
    // across the sweep boundary (max just before + max just after).
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (now > entry.resetAt) hits.delete(key);
        }
    }, windowMs);
    if (typeof sweep.unref === 'function') sweep.unref();

    return function rateLimiter(req, res, next) {
        const now = Date.now();
        const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
        const entry = hits.get(key);

        if (!entry || now > entry.resetAt) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        entry.count += 1;

        if (entry.count > max) {
            res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
            return res.status(429).json({
                success: false,
                message: 'Too many requests, please slow down.',
            });
        }

        next();
    };
}

module.exports = rateLimit;
