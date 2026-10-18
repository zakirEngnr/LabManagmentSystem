// Minimal HTTP security response headers.
// Written in-house so the project keeps zero extra dependencies.
function securityHeaders(req, res, next) {
    // Stop MIME-type sniffing turning uploads/JSON into active content.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // This API returns JSON only — it must never be framed.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Responses carry patient health data: browsers and shared proxies must
    // never store them. Without an explicit directive, intermediaries are free
    // to cache any response that lacks one.
    res.setHeader('Cache-Control', 'no-store');

    // HSTS: once served over HTTPS, refuse to speak plain HTTP for a year.
    // Only meaningful on secure transports, so it is skipped for plain HTTP.
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // The JSON API has no markup or scripts — lock it down completely.
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    next();
}

// A relaxed CSP for the printable report endpoint. The report is a full HTML
// document (opened in its own tab/window) with an inline <style> block and a
// small inline print <script>; the strict API policy above (default-src 'none')
// would block those and break printing. We permit only the inline style/script
// and safe system fonts, and still forbid framing and plugin/content.
// This is mounted only on the report route, never on the JSON API.
function reportCsp(req, res, next) {
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'unsafe-inline'",
            "style-src 'unsafe-inline'",
            "font-src 'self' data:",
            "img-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "object-src 'none'",
        ].join('; ')
    );
    next();
}

module.exports = securityHeaders;
module.exports.reportCsp = reportCsp;
