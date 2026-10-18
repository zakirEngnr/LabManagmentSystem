function errorMiddleware(err, req, res, next) {
    // If Express has already started sending the response,
    // let its default error handler finish.
    if (res.headersSent) {
        return next(err);
    }

    const statusCode =
        Number.isInteger(err.status) &&
        err.status >= 400 &&
        err.status <= 599
            ? err.status
            : 500;

    // Log the actual error on the server for debugging.
    console.error('Server error:', {
        method: req.method,
        path: req.originalUrl,
        statusCode,
        message: err.message,
    });

    // Do not expose unexpected internal errors to clients.
    const message =
        statusCode >= 500
            ? 'Internal server error'
            : err.message || 'Request failed';

    return res.status(statusCode).json({
        success: false,
        message,
    });
}

module.exports = errorMiddleware;