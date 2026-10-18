

'use strict';

require('dotenv').config();

const createApp = require('./app');
const { prisma, initDatabase } = require('./config/db');

const PORT = Number.parseInt(process.env.PORT, 10) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Must match the rule enforced in middleware/authMiddleware.js. Refuse to boot
// a server whose API is guaranteed to reject every request.
const token = process.env.API_TOKEN;
if (!token || token.length < 16) {
    console.error(
        '[server] API_TOKEN is missing or shorter than 16 characters.\n' +
            '         Set a strong API_TOKEN in backend/.env (see .env.example) ' +
            'before starting the server.'
    );
    process.exit(1);
}

/** Close the HTTP server and the Prisma pool, tolerating either hanging. */
async function closeAll(server) {
    if (server && server.listening) {
        await new Promise((resolve) => server.close(resolve));
    }
    await prisma.$disconnect();
}

async function start() {
    // PRAGMAs first: without WAL + busy_timeout, concurrent writers collide.
    try {
        await initDatabase();
    } catch (err) {
        console.error('[server] Failed to initialise the database:', err.message);
        console.error('         Has `npx prisma generate` / `npm run db:migrate` been run?');
        process.exit(1);
    }

    const app = createApp();
    const server = app.listen(PORT, HOST);

    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });

    const { port } = server.address();
    console.log(`[server] Arham Diagnostic Laboratory API listening on http://${HOST}:${port}`);
    console.log(`[server] env: ${process.env.NODE_ENV || 'development'} · health: /api/health`);

    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[server] ${signal} received — shutting down gracefully.`);
        try {
            await closeAll(server);
            console.log('[server] Closed. Bye.');
            process.exit(0);
        } catch (err) {
            console.error('[server] Error during shutdown:', err);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Keep the promise chain from becoming an unhandled rejection source.
    process.on('unhandledRejection', (reason) => {
        console.error('[server] Unhandled promise rejection:', reason);
    });
}

// Only auto-start when executed directly, so `require('./server')` from a
// future integration test cannot double-bind the port.
if (require.main === module) {
    start().catch((err) => {
        console.error('[server] Failed to start:', err);
        process.exit(1);
    });
}

module.exports = { start, closeAll, PORT, HOST };