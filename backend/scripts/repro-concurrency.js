// scripts/repro-concurrency.js
// Focused reproduction of the write-concurrency defects.
//   Usage: node scripts/repro-concurrency.js [N]
//
// Prints, for N simultaneous patient creations:
//   * how many succeeded vs. returned a 500
//   * how many duplicate patientIds were handed out
//   * how far the counter actually advanced (lost-update detection)
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `repro-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TMP_DB}`;
process.env.API_TOKEN = 'repro-token-0123456789abcdef';
process.env.NODE_ENV = 'test';

fs.copyFileSync(path.join(__dirname, '..', 'prisma', 'clinic.db'), TMP_DB);

const createApp = require('../src/app');
const { prisma, initDatabase } = require('../src/config/db');

async function main() {
    const N = Number(process.argv[2]) || 40;

    await initDatabase();
    await prisma.labValue.deleteMany();
    await prisma.labRecord.deleteMany();
    await prisma.labVisit.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.counter.upsert({ where: { name: 'patient' }, update: { value: 1000 }, create: { name: 'patient', value: 1000 } });

    const app = createApp();
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    const before = await prisma.counter.findUnique({ where: { name: 'patient' } });
    console.log(`\nFiring ${N} concurrent POST /api/patients ...`);
    const t0 = Date.now();

    const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
            fetch(`${origin}/api/patients`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: `P${i}`, age: 30, gender: 'Male' }),
            }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }))
        )
    );

    const ms = Date.now() - t0;
    const ok = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    const ids = ok.map((r) => r.body && r.body.data && r.body.data.patientId).filter(Boolean);
    const dupes = ids.length - new Set(ids).size;
    const after = await prisma.counter.findUnique({ where: { name: 'patient' } });

    console.log(`  elapsed            : ${ms} ms`);
    console.log(`  succeeded (201)    : ${ok.length}/${N}`);
    console.log(`  failed (5xx/other) : ${failed.length}/${N}`);
    console.log(`  duplicate IDs      : ${dupes}`);
    console.log(`  counter advanced   : ${after.value - before.value} (expected ${N})`);
    console.log(`  rows in Patient    : ${await prisma.patient.count()} (expected ${N})`);

    if (failed.length) {
        const byMsg = {};
        for (const f of failed) {
            const m = (f.body && f.body.message) || 'unknown';
            byMsg[m] = (byMsg[m] || 0) + 1;
        }
        console.log('  failure reasons    :', JSON.stringify(byMsg, null, 2));
    }

    const healthy = failed.length === 0 && dupes === 0 && after.value - before.value === N;
    console.log(`\n  => ${healthy ? 'HEALTHY' : 'DEFECT PRESENT'}\n`);

    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
    for (const s of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + s, { force: true });
    process.exit(healthy ? 0 : 1);
}

main().catch(async (e) => {
    console.error('repro crashed:', e);
    await prisma.$disconnect().catch(() => {});
    process.exit(2);
});
