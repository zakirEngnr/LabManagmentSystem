
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    log:
        process.env.NODE_ENV === 'production'
            ? [{ emit: 'event', level: 'error' }]
            : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});

if (typeof prisma.$on === 'function') {
    prisma.$on('warn', (e) => console.warn('[prisma warn]', e.message));
    prisma.$on('error', (e) => console.error('[prisma error]', e.message));
}


async function initDatabase() {

    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');

    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000;');

    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
}

module.exports = prisma;
module.exports.prisma = prisma;
module.exports.initDatabase = initDatabase;