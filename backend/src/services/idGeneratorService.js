
//
//
// *interactive* transaction. On SQLite that acquires the single write lock and
// holds it for the whole JS round-trip, so requests serialise behind each
// other. Under 40 concurrent patient creations 32 of them died with
// "Transaction already closed ... timeout was 5000 ms" and the counter only
// advanced by 8 — the clinic would have issued DUPLICATE PT- ids.
//
// `{ increment: 1 }` compiles to ONE atomic statement
// (`UPDATE "Counter" SET "value" = "value" + 1 WHERE "name" = ?`), which SQLite
// serialises itself. Dropping the interactive transaction makes it both correct
// and dramatically faster (40/40 unique in ~23 ms measured).

const prisma = require('../config/db');

const FIRST_VALUE = 1001; // the very first ID handed out
const MAX_ATTEMPTS = 5; // bounded retries, never an unbounded loop

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isUniqueViolation(err) {
    return (
        !!err &&
        (err.code === 'P2002' || /UNIQUE constraint failed/i.test(err.message || ''))
    );
}

/**
 * Atomically reserve the next number for a counter.
 *
 * The only racy window is the very first call, when two requests may both find
 * the row missing and race to INSERT it. SQLite's unique index on `name`
 * rejects the loser, which simply retries and takes the UPDATE path.
 */
async function reserve(name) {
    let lastErr;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const row = await prisma.counter.upsert({
                where: { name },
                update: { value: { increment: 1 } },
                create: { name, value: FIRST_VALUE },
            });
            return row.value;
        } catch (err) {
            lastErr = err;
            if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) {
                // Jittered backoff so simultaneous losers don't collide again.
                await sleep(Math.random() * attempt * 5);
                continue;
            }
            throw err;
        }
    }

    throw lastErr;
}

// Create a patient with an auto-generated PT-XXXX id
async function createPatientWithId(data) {
    let lastErr;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const n = await reserve('patient');
        try {
            // A separate statement keeps the counter bump out of a
            // long-running transaction. A collision here is theoretically
            // possible only if the counter were ever rewound, so we re-reserve.
            return await prisma.patient.create({
                data: { ...data, patientId: `PT-${n}` },
            });
        } catch (err) {
            lastErr = err;
            if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue;
            throw err;
        }
    }

    throw lastErr;
}

// Create a visit with an auto-generated LV-XXXX number
async function createVisitWithNumber(data) {
    let lastErr;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const n = await reserve('visit');
        try {
            // Nested writes stay in ONE create() call: Prisma executes them as a
            // single atomic unit without an interactive transaction, so the
            // visit and its records can never half-exist.
            return await prisma.labVisit.create({
                data: { ...data, visitNumber: `LV-${n}` },
            });
        } catch (err) {
            lastErr = err;
            if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue;
            throw err;
        }
    }

    throw lastErr;
}

module.exports = { createPatientWithId, createVisitWithNumber, reserve, FIRST_VALUE };
