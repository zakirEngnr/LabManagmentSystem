// tests/e2e.test.js
// End-to-end + concurrency suite.
//
// Uses only Node's built-in test runner and global fetch — the project has no
// jest/supertest, and this keeps the dependency list untouched.
// Run with:  npm test
//
// The suite boots the real Express app against a THROWAWAY copy of the
// database so it can never corrupt development data.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');

// Isolated database + app bootstrap
const TMP_DB = path.join(os.tmpdir(), `clinic-e2e-${process.pid}-${Date.now()}.db`);
const MAIN_DB = path.join(__dirname, '..', 'prisma', 'clinic.db');

// Set BEFORE requiring the app: db.js constructs PrismaClient at require time
// and dotenv does not override variables that are already present.
process.env.DATABASE_URL = `file:${TMP_DB}`;
process.env.API_TOKEN = 'test-token-0123456789abcdef';
process.env.NODE_ENV = 'test';

fs.copyFileSync(MAIN_DB, TMP_DB);

const createApp = require('../src/app');
const { prisma, initDatabase } = require('../src/config/db');

const TOKEN = process.env.API_TOKEN;

let server;
let origin = '';

/** Fetch wrapper that always attaches auth and parses JSON. */
async function api(pathname, { method = 'GET', body, token = TOKEN } = {}) {
    const res = await fetch(origin + pathname, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
        json = await res.json();
    } catch {
        /* non-JSON body */
    }
    return { status: res.status, headers: res.headers, body: json };
}

/** Fire n requests simultaneously; resolve to their responses. */
async function inParallel(n, fn) {
    return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

/** POST /api/patients and return the generated patientId. */
async function newPatient(name = 'Test Patient') {
    const res = await api('/api/patients', {
        method: 'POST',
        body: { name, age: 30, gender: 'Male' },
    });
    assert.strictEqual(res.status, 201, `could not create patient: ${JSON.stringify(res.body)}`);
    return res.body.data.patientId;
}

/**
 * Today's date as YYYY-MM-DD in LOCAL time — the reports API buckets visits by
 * LOCAL day, so tests must build their ranges the same way. toISOString()
 * (UTC) diverges from local time for 5 hours a day in UTC+5 zones.
 */
function localDate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

before(async () => {
    await initDatabase();

    // Clean slate so counter expectations are deterministic.
    await prisma.labValue.deleteMany();
    await prisma.labRecord.deleteMany();
    await prisma.labVisit.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.counter.upsert({ where: { name: 'patient' }, update: { value: 1000 }, create: { name: 'patient', value: 1000 } });
    await prisma.counter.upsert({ where: { name: 'visit' }, update: { value: 1000 }, create: { name: 'visit', value: 1000 } });

    const app = createApp();
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await prisma.$disconnect();
    for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(TMP_DB + suffix, { force: true });
    }
});
// 1. SMOKE
describe('health', () => {
    test('GET /api/health returns ok', async () => {
        const res = await api('/api/health', { token: null });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.data.status, 'ok');
    });
});

// 2. SECURITY
describe('security', () => {
    test('rejects requests with no Authorization header', async () => {
        const res = await api('/api/patients', { token: null });
        assert.strictEqual(res.status, 401);
    });

    test('rejects a wrong token', async () => {
        const res = await api('/api/patients', { token: 'not-the-real-token' });
        assert.strictEqual(res.status, 401);
    });

    test('rejects a malformed Authorization scheme', async () => {
        const res = await fetch(origin + '/api/patients', { headers: { Authorization: TOKEN } });
        assert.strictEqual(res.status, 401);
    });

    test('accepts the correct token', async () => {
        const res = await api('/api/patients');
        assert.strictEqual(res.status, 200);
    });

    test('does not leak the framework via X-Powered-By', async () => {
        const res = await api('/api/health', { token: null });
        assert.strictEqual(res.headers.get('x-powered-by'), null);
    });

    test('sets hardening headers', async () => {
        const res = await api('/api/health', { token: null });
        assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    });

    test('returns 404 for an unknown route', async () => {
        const res = await api('/api/does-not-exist');
        assert.strictEqual(res.status, 404);
    });

    test('does not leak parser internals on malformed JSON', async () => {
        const res = await fetch(origin + '/api/patients', {
            method: 'POST',
            headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
            body: '{ this is not json',
        });
        assert.ok(res.status >= 400);
        const text = JSON.stringify(res.body);
        assert.ok(!/Unexpected token/i.test(text), 'raw parser error leaked to client');
    });

    test('rejects oversized payloads', async () => {
        const res = await api('/api/patients', {
            method: 'POST',
            body: { name: 'x'.repeat(200_000) },
        });
        assert.ok(res.status === 413 || res.status === 400, `expected 413/400, got ${res.status}`);
    });

    test('reflects CORS only for allowed local origins', async () => {
        const allowed = await fetch(origin + '/api/health', {
            headers: { Origin: 'http://localhost:3000' },
        });
        assert.strictEqual(
            allowed.headers.get('access-control-allow-origin'),
            'http://localhost:3000',
            'localhost origin should be allowed'
        );
    });

    test('does NOT send CORS headers to an unknown origin', async () => {
        const blocked = await fetch(origin + '/api/health', {
            headers: { Origin: 'https://evil.example.com' },
        });
        assert.strictEqual(
            blocked.headers.get('access-control-allow-origin'),
            null,
            'an unknown origin must not receive an Access-Control-Allow-Origin header'
        );
    });

    test('never uses a CORS wildcard with credentials', async () => {
        const res = await fetch(origin + '/api/health', {
            headers: { Origin: 'http://localhost:3000' },
        });
        assert.notStrictEqual(res.headers.get('access-control-allow-origin'), '*');
        assert.notStrictEqual(res.headers.get('access-control-allow-credentials'), 'true');
    });

    test('report endpoint uses a relaxed CSP that allows the report to render', async () => {
        const patientId = await newPatient('CSP Patient');
        const visit = (
            await api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T002'] },
            })
        ).body.data;

        const res = await api(`/api/visits/${visit.id}/report`);
        assert.strictEqual(res.status, 200);

        // The JSON API's policy is `default-src 'none'`; the report must not be.
        const csp = res.headers.get('content-security-policy') || '';
        assert.ok(!/default-src 'none'/.test(csp), 'report must not inherit the API no-src policy');
        assert.ok(/style-src/.test(csp) && /script-src/.test(csp), 'report CSP must permit style/script');

        // A normal JSON endpoint keeps the strict policy.
        const apiCsp = (await api('/api/health', { token: null })).headers.get('content-security-policy') || '';
        assert.ok(/default-src 'none'/.test(apiCsp), 'JSON API must keep default-src none');
    });

    test('rejects an unknown gender value', async () => {
        const res = await api('/api/patients', {
            method: 'POST',
            body: { name: 'Bad Gender', age: 30, gender: 'Robot' },
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
    });

    test('rejects an out-of-range age', async () => {
        const tooOld = await api('/api/patients', {
            method: 'POST',
            body: { name: 'Ancient', age: 999, gender: 'Male' },
        });
        assert.strictEqual(tooOld.status, 400);

        const negative = await api('/api/patients', {
            method: 'POST',
            body: { name: 'Negative', age: -5, gender: 'Male' },
        });
        assert.strictEqual(negative.status, 400);
    });

    test('rejects an over-long name', async () => {
        const res = await api('/api/patients', {
            method: 'POST',
            body: { name: 'x'.repeat(200), age: 30, gender: 'Male' },
        });
        assert.strictEqual(res.status, 400);
    });

    test('still accepts valid boundary values (age 0, empty optional contact)', async () => {
        const res = await api('/api/patients', {
            method: 'POST',
            body: { name: 'Newborn', age: 0, gender: 'Other', contact: '' },
        });
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.data.contact, null, 'empty contact should normalise to null');
    });
});

// 3. HAPPY PATH
describe('happy path', () => {
    test('creates a patient with a PT- id', async () => {
        const res = await api('/api/patients', {
            method: 'POST',
            body: { name: 'Ahmed Khan', age: 34, gender: 'Male', contact: '0300' },
        });
        assert.strictEqual(res.status, 201);
        assert.match(res.body.data.patientId, /^PT-\d+$/);
    });

    test('validates required fields', async () => {
        const res = await api('/api/patients', { method: 'POST', body: { name: 'No Age' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
    });

    test('creates a visit and computes the total', async () => {
        const patientId = await newPatient('Sara Ali');
        const res = await api('/api/visits', {
            method: 'POST',
            body: { patientId, testCodes: ['T001', 'T002'] },
        });
        assert.strictEqual(res.status, 201);
        assert.match(res.body.data.visitNumber, /^LV-\d+$/);
        assert.strictEqual(res.body.data.records.length, 2);
        assert.strictEqual(res.body.data.totalAmount, 700); // 500 + 200
    });

    test('rejects a visit with no tests', async () => {
        const patientId = await newPatient('Visit Test');
        const res = await api('/api/visits', {
            method: 'POST',
            body: { patientId, testCodes: [] },
        });
        assert.strictEqual(res.status, 400);
    });

    test('rejects an unknown patient', async () => {
        const res = await api('/api/visits', {
            method: 'POST',
            body: { patientId: 'PT-999999', testCodes: ['T001'] },
        });
        assert.strictEqual(res.status, 404);
    });

    test('saves results and auto-completes the visit', async () => {
        const patientId = await newPatient('Results Patient');
        const visit = (
            await api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T003'] }, // single-field test
            })
        ).body.data;

        const detail = (await api(`/api/visits/${visit.id}`)).body.data;
        const fieldId = detail.records[0].test.fields[0].id;

        const res = await api(`/api/visits/records/${detail.records[0].id}/results`, {
            method: 'PUT',
            body: { values: [{ fieldId, value: '8' }] },
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.data.visitCompleted, true);

        const after = (await api(`/api/visits/${visit.id}`)).body.data;
        assert.strictEqual(after.status, 'Completed');
    });

    test('rejects fieldIds that do not belong to the test', async () => {
        const patientId = await newPatient('Bad Field');
        const visit = (
            await api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T002'] },
            })
        ).body.data;

        const res = await api(`/api/visits/records/${visit.records[0].id}/results`, {
            method: 'PUT',
            body: { values: [{ fieldId: 'bogus-field-id', value: '1' }] },
        });
        assert.strictEqual(res.status, 400);
    });

    test('marks a visit paid and rejects invalid statuses', async () => {
        const patientId = await newPatient('Payer');
        const visit = (
            await api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T002'] },
            })
        ).body.data;

        const ok = await api(`/api/visits/${visit.id}/payment`, {
            method: 'PUT',
            body: { paymentStatus: 'Paid' },
        });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.body.data.paymentStatus, 'Paid');

        const bad = await api(`/api/visits/${visit.id}/payment`, {
            method: 'PUT',
            body: { paymentStatus: 'Maybe' },
        });
        assert.strictEqual(bad.status, 400);
    });
});

// 4. CONCURRENCY  <-- the heart of this suite
describe('concurrency', () => {
    test('40 simultaneous patient creates all succeed with UNIQUE ids', async () => {
        const N = 40;
        const before = await prisma.counter.findUnique({ where: { name: 'patient' } });

        const results = await inParallel(N, (i) =>
            api('/api/patients', {
                method: 'POST',
                body: { name: `Concurrent ${i}`, age: 30, gender: 'Male' },
            })
        );

        const failures = results.filter((r) => r.status !== 201);
        assert.strictEqual(
            failures.length,
            0,
            `${failures.length}/${N} requests failed.\nFirst failure: ${JSON.stringify(failures[0]?.body)}`
        );

        const ids = results.map((r) => r.body.data.patientId);
        assert.strictEqual(
            new Set(ids).size,
            N,
            `Duplicate patientIds under concurrency! ${new Set(ids).size} unique out of ${N}`
        );

        // The counter must advance exactly N — no lost updates.
        const after = await prisma.counter.findUnique({ where: { name: 'patient' } });
        assert.strictEqual(
            after.value - before.value,
            N,
            `Counter drifted: expected +${N}, got +${after.value - before.value} (lost update)`
        );
    });

    test('30 simultaneous visit creates all succeed with UNIQUE numbers', async () => {
        const N = 30;
        const patientId = await newPatient('Visit Concurrency');
        const before = await prisma.counter.findUnique({ where: { name: 'visit' } });

        const results = await inParallel(N, () =>
            api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T002'] },
            })
        );

        const failures = results.filter((r) => r.status !== 201);
        assert.strictEqual(
            failures.length,
            0,
            `${failures.length}/${N} visit requests failed.\nFirst: ${JSON.stringify(failures[0]?.body)}`
        );

        const numbers = results.map((r) => r.body.data.visitNumber);
        assert.strictEqual(
            new Set(numbers).size,
            N,
            `Duplicate visitNumbers under concurrency! ${new Set(numbers).size}/${N}`
        );

        const after = await prisma.counter.findUnique({ where: { name: 'visit' } });
        assert.strictEqual(
            after.value - before.value,
            N,
            `Visit counter drifted: expected +${N}, got +${after.value - before.value}`
        );
    });

    test('concurrent result entry completes the visit', async () => {
        // A 3-test visit (each single-field) completed by 3 parallel requests.
        const patientId = await newPatient('Parallel Results');
        const visit = (
            await api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T002', 'T003', 'T018'] },
            })
        ).body.data;

        const detail = (await api(`/api/visits/${visit.id}`)).body.data;

        const saves = await inParallel(detail.records.length, async (i) => {
            const record = detail.records[i];
            const fieldId = record.test.fields[0].id;
            return api(`/api/visits/records/${record.id}/results`, {
                method: 'PUT',
                body: { values: [{ fieldId, value: String(i) }] },
            });
        });

        const failed = saves.filter((r) => r.status !== 200);
        assert.strictEqual(failed.length, 0, `parallel saves failed: ${JSON.stringify(failed[0]?.body)}`);

        const final = (await api(`/api/visits/${visit.id}`)).body.data;
        assert.strictEqual(final.status, 'Completed', 'visit not completed after parallel result entry');
        assert.ok(final.records.every((r) => r.resultStatus === 'Completed'));
    });

    test('no duplicate LabValue rows when the same result is saved 5x at once', async () => {
        const patientId = await newPatient('Double Save');
        const visit = (
            await api('/api/visits', {
                method: 'POST',
                body: { patientId, testCodes: ['T003'] },
            })
        ).body.data;

        const recordId = visit.records[0].id;
        const fieldId = (await api(`/api/visits/${visit.id}`)).body.data.records[0].test.fields[0].id;

        await inParallel(5, () =>
            api(`/api/visits/records/${recordId}/results`, {
                method: 'PUT',
                body: { values: [{ fieldId, value: '7' }] },
            })
        );

        const count = await prisma.labValue.count({ where: { labRecordId: recordId } });
        assert.strictEqual(count, 1, `expected exactly 1 LabValue, found ${count} (lost update / duplication)`);
    });
});
// 5. REPORTS SUMMARY  (aggregation endpoint)
describe('reports summary', () => {
    test('rejects unauthenticated access', async () => {
        const res = await api('/api/reports/summary', { token: null });
        assert.strictEqual(res.status, 401);
    });

    test('rejects an invalid from-date', async () => {
        const res = await api('/api/reports/summary?from=not-a-date&to=2026-01-02');
        assert.strictEqual(res.status, 400);
        assert.match(res.body.message, /date/i);
    });

    test('rejects a date range longer than one year', async () => {
        const res = await api('/api/reports/summary?from=2020-01-01&to=2026-01-01');
        assert.strictEqual(res.status, 400);
        assert.match(res.body.message, /year/i);
    });

    test('returns a well-formed summary for a valid range', async () => {
        // Seed a patient + a paid visit dated today so the numbers are predictable.
        const patientId = await newPatient('Summary Patient');
        await api('/api/visits', { method: 'POST', body: { patientId, testCodes: ['T003'] } });

        const today = localDate();
        const res = await api(`/api/reports/summary?from=${today}&to=${today}`);
        assert.strictEqual(res.status, 200);

        const s = res.body.data;
        assert.ok(s.range && s.income && s.visits && s.patients, 'summary must have range/income/visits/patients');
        assert.ok(Array.isArray(s.byDay), 'byDay must be an array');
        assert.strictEqual(typeof s.income.total, 'number');
        assert.ok(s.visits.total >= 1, 'at least one visit should be counted');
        assert.strictEqual(typeof s.patients.new, 'number');
        assert.strictEqual(typeof s.patients.returning, 'number');
    });

    test('swaps a reversed from/to range', async () => {
        const res = await api('/api/reports/summary?from=2026-01-31&to=2026-01-01');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.data.range.from, '2026-01-01');
        assert.strictEqual(res.body.data.range.to, '2026-01-31');
    });

    test('print endpoint returns HTML with a RELAXED CSP (not the JSON-only policy)', async () => {
        const today = localDate();
        const res = await fetch(`${origin}/api/reports/summary/print?from=${today}&to=${today}`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        assert.strictEqual(res.status, 200);

        const csp = res.headers.get('content-security-policy') || '';
        // The strict API policy is `default-src 'none'`. The printable summary
        // must NOT carry that, or its inline <style>/<script> would be blocked.
        assert.ok(!csp.includes("default-src 'none'"), `print CSP must be relaxed, got: ${csp}`);
        assert.ok(res.headers.get('content-type').includes('text/html'));

        const html = await res.text();
        assert.ok(html.includes('</html>'), 'print response should be a full HTML document');
    });

    test('print endpoint still requires auth', async () => {
        const today = localDate();
        const res = await fetch(`${origin}/api/reports/summary/print?from=${today}&to=${today}`);
        assert.strictEqual(res.status, 401);
    });
});

// 6. AGGREGATION CORRECTNESS — local-day bucketing, income math,
//    zero-record visits, and the printable summary.
//
// Visits are seeded directly (with fixed LOCAL timestamps) because the API
// always stamps visitDate = now. The dates are unique to this suite, so no
// other test can pollute the window.
describe('aggregation correctness over a fixed 3-day window', () => {
    const D1 = '2026-05-05';
    const D2 = '2026-05-06';
    const D3 = '2026-05-07';

    let visitD3;          // Paid, one Pending record (T006 Widal)
    let recordD3Id;

    // Local-time instants: 00:00:30 and 23:59:30 straddle the day boundaries.
    // Under the old UTC bucketing, in any UTC+x zone these landed on the
    // PREVIOUS day and the whole window shifted by one.
    before(async () => {
        const p1 = (await api('/api/patients', {
            method: 'POST', body: { name: 'Bucket One', age: 40, gender: 'Male' },
        })).body.data;
        const p2 = (await api('/api/patients', {
            method: 'POST', body: { name: 'Bucket Two', age: 22, gender: 'Female' },
        })).body.data;
        const p3 = (await api('/api/patients', {
            method: 'POST', body: { name: 'Bucket Three', age: 65, gender: 'Male' },
        })).body.data;

        const tests = (await api('/api/tests')).body.data;
        const widal = tests.find((t) => t.testCode === 'T006');
        assert.ok(widal, 'seed must provide T006 (Widal)');

        await prisma.labVisit.create({
            data: {
                visitNumber: 'V-TEST-D1',
                patientId: p1.id,
                visitDate: new Date('2026-05-05T00:00:30.000'), // local 00:00:30
                totalAmount: 777,
                paymentStatus: 'Paid',
            },
        });

        await prisma.labVisit.create({
            data: {
                visitNumber: 'V-TEST-D2',
                patientId: p2.id,
                visitDate: new Date('2026-05-06T23:59:30.000'), // local 23:59:30
                totalAmount: 333,
                paymentStatus: 'Unpaid',
            },
        });

        visitD3 = await prisma.labVisit.create({
            data: {
                visitNumber: 'V-TEST-D3',
                patientId: p3.id,
                visitDate: new Date('2026-05-07T12:00:00.000'),
                totalAmount: widal.price,
                paymentStatus: 'Paid',
                records: {
                    create: [{
                        patientId: p3.id,
                        testId: widal.id,
                        priceAtVisit: widal.price,
                    }],
                },
            },
        });

        const full = await prisma.labVisit.findUnique({
            where: { id: visitD3.id },
            include: { records: true },
        });
        recordD3Id = full.records[0].id;
    });

    test('bucketing is LOCAL: visits at local 00:00:30 / 23:59:30 stay on their own day', async () => {
        const d1 = (await api(`/api/reports/summary?from=${D1}&to=${D1}`)).body.data;
        assert.strictEqual(d1.visits.total, 1, 'D1 boundary visit must be in the D1 bucket');
        assert.strictEqual(d1.income.paid, 777);

        const d2 = (await api(`/api/reports/summary?from=${D2}&to=${D2}`)).body.data;
        assert.strictEqual(d2.visits.total, 1, 'D2 boundary visit must be in the D2 bucket');
        assert.strictEqual(d2.income.unpaid, 333);

        const d3 = (await api(`/api/reports/summary?from=${D3}&to=${D3}`)).body.data;
        assert.strictEqual(d3.visits.total, 1);
    });

    test('visits with zero records are PENDING, never Completed', async () => {
        const s = (await api(`/api/reports/summary?from=${D1}&to=${D2}`)).body.data;
        assert.strictEqual(s.visits.total, 2);
        assert.strictEqual(s.visits.completed, 0, '[].every() must not count record-less visits as completed');
        assert.strictEqual(s.visits.pending, 2);
    });

    test('income math: total = paid + unpaid, byDay income column sums to PAID only', async () => {
        const s = (await api(`/api/reports/summary?from=${D1}&to=${D3}`)).body.data;

        assert.strictEqual(s.income.total, 777 + 333 + 200);
        assert.strictEqual(s.income.paid, 777 + 200);
        assert.strictEqual(s.income.unpaid, 333);

        // The by-day "income" column only ever counts PAID visits...
        const colSum = s.byDay.reduce((n, d) => n + d.income, 0);
        assert.strictEqual(colSum, s.income.paid, 'sum(byDay.income) must equal income.paid');
        const visitSum = s.byDay.reduce((n, d) => n + d.visits, 0);
        assert.strictEqual(visitSum, s.visits.total, 'sum(byDay.visits) must equal visits.total');

        // ...and every visit lands in exactly one local-day bucket.
        assert.strictEqual(s.byDay.length, 3);
        assert.deepStrictEqual(s.byDay.map((d) => d.date), [D1, D2, D3]);

        // Unique / new / returning patients over the window.
        assert.strictEqual(s.patients.unique, 3);
        assert.strictEqual(s.patients.new, 3, 'their FIRST ever visit is inside the window');
        assert.strictEqual(s.patients.returning, 0);
    });

    test('summary JSON carries the name/category fields the UI renders', async () => {
        const s = (await api(`/api/reports/summary?from=${D3}&to=${D3}`)).body.data;
        assert.strictEqual(s.byTest.length, 1);
        assert.strictEqual(s.byTest[0].name, 'Widal');            // reports.js reads t.name
        assert.strictEqual(s.byTest[0].category, 'Serology');
        assert.strictEqual(s.byCategory.length, 1);
        assert.strictEqual(s.byCategory[0].category, 'Serology'); // print reads c.category
    });

    test('print summary: TOTAL row = PAID total; category & test names are real (not em-dash)', async () => {
        const res = await fetch(`${origin}/api/reports/summary/print?from=${D1}&to=${D3}`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        assert.strictEqual(res.status, 200);
        const html = await res.text();

        // The by-day TOTAL row sits under a PAID-income column, so it must show
        // the paid sum (977), not paid+unpaid (1,310).
        assert.ok(html.includes('<strong>Rs. 977</strong>'), 'TOTAL row must show the paid sum');
        assert.ok(!html.includes('<strong>Rs. 1,310</strong>'), 'TOTAL row must not show paid+unpaid');

        // Category breakdown previously rendered `c.name` (undefined) as "—".
        assert.ok(html.includes('Serology'), 'category name must be rendered');
        assert.ok(!html.includes('<td>—</td>'), 'no em-dash placeholder cells');

        // Test breakdown name.
        assert.ok(html.includes('Widal'), 'test name must be rendered');
    });

    test('full flow: enter results → record completes → visit auto-completes → summary flips', async () => {
        // Enter the result for D3's only record.
        const record = (await api(`/api/visits/records/${recordD3Id}`)).body.data;
        const fieldId = record.test.fields[0].id;

        const save = await api(`/api/visits/records/${recordD3Id}/results`, {
            method: 'PUT',
            body: { values: [{ fieldId, value: 'Negative' }] },
        });
        assert.strictEqual(save.status, 200);
        assert.strictEqual(save.body.data.saved, true);

        // All of the visit's records are done → the visit itself completes.
        const after = (await api(`/api/visits/${visitD3.id}`)).body.data;
        assert.strictEqual(after.status, 'Completed', 'visit must auto-complete when its last record is saved');
        assert.strictEqual(after.records[0].resultStatus, 'Completed');

        // The aggregation reflects the flip.
        const s = (await api(`/api/reports/summary?from=${D1}&to=${D3}`)).body.data;
        assert.strictEqual(s.visits.completed, 1, 'D3 now has records, all done');
        assert.strictEqual(s.visits.pending, 2, 'D1/D2 still have no records');

        // Re-saving replaces values rather than duplicating them.
        const again = await api(`/api/visits/records/${recordD3Id}/results`, {
            method: 'PUT',
            body: { values: [{ fieldId, value: 'Negative' }] },
        });
        assert.strictEqual(again.status, 200);
        const count = await prisma.labValue.count({ where: { labRecordId: recordD3Id } });
        assert.strictEqual(count, 1, 're-saving must replace, not duplicate');
    });
});

// 7. INPUT VALIDATION HARDENING — malformed payloads must be a
//    clean 400, never a masked Prisma 500.
describe('input validation hardening', () => {
    test('create visit rejects a non-string patientId', async () => {
        const res = await api('/api/visits', {
            method: 'POST',
            body: { patientId: { id: 'sneaky' }, testCodes: ['T003'] },
        });
        assert.strictEqual(res.status, 400);
        assert.match(res.body.message, /patientId/i);
    });

    test('create visit rejects non-string test codes', async () => {
        const res = await api('/api/visits', {
            method: 'POST',
            body: { patientId: 'PT-1001', testCodes: [123, null] },
        });
        assert.strictEqual(res.status, 400);
        assert.match(res.body.message, /testCodes/i);
    });

    test('duplicate test codes create ONE record per code at the right total', async () => {
        const patientId = await newPatient('Duplicate Code Patient');
        const tests = (await api('/api/tests')).body.data;
        const t = tests.find((x) => x.testCode === 'T003');

        const res = await api('/api/visits', {
            method: 'POST',
            body: { patientId, testCodes: ['T003', 'T003'] },
        });
        assert.strictEqual(res.status, 201, JSON.stringify(res.body));
        assert.strictEqual(res.body.data.records.length, 1, 'duplicate code must not create two records');
        assert.strictEqual(res.body.data.totalAmount, t.price, 'total must count the code once');
    });

    test('save results rejects a null entry instead of crashing with 500', async () => {
        const res = await api('/api/visits/records/any-id/results', {
            method: 'PUT',
            body: { values: [null] },
        });
        assert.strictEqual(res.status, 400);
    });

    test('save results rejects a non-string fieldId', async () => {
        const res = await api('/api/visits/records/any-id/results', {
            method: 'PUT',
            body: { values: [{ fieldId: 123, value: 'x' }] },
        });
        assert.strictEqual(res.status, 400);
    });

    test('save results rejects an oversized value (255 char cap)', async () => {
        const res = await api('/api/visits/records/any-id/results', {
            method: 'PUT',
            body: { values: [{ fieldId: 'f1', value: 'x'.repeat(256) }] },
        });
        assert.strictEqual(res.status, 400);
        assert.match(res.body.message, /255/);
    });

    test('save results still accepts a well-formed payload (happy path)', async () => {
        const patientId = await newPatient('Happy Path Patient');
        const created = await api('/api/visits', {
            method: 'POST',
            body: { patientId, testCodes: ['T006'] },
        });
        assert.strictEqual(created.status, 201);
        const recId = created.body.data.records[0].id;

        const record = (await api(`/api/visits/records/${recId}`)).body.data;
        const fieldId = record.test.fields[0].id;

        const save = await api(`/api/visits/records/${recId}/results`, {
            method: 'PUT',
            body: { values: [{ fieldId, value: 'Negative' }] },
        });
        assert.strictEqual(save.status, 200, JSON.stringify(save.body));
        assert.strictEqual(save.body.data.saved, true);
    });

    test('rejects JSON bodies over the 100kb cap', async () => {
        const res = await api('/api/patients', {
            method: 'POST',
            body: { name: 'Big Body', age: 30, gender: 'Male', address: 'x'.repeat(150_000) },
        });
        assert.strictEqual(res.status, 413);
    });
});

// 8. SECURITY — cache headers, rate limiting, XSS in printed reports
describe('security hardening', () => {
    test('API responses carry Cache-Control: no-store (patient data must not be cached)', async () => {
        const ok = await api('/api/health', { token: null });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.headers.get('cache-control'), 'no-store');

        const denied = await api('/api/patients', { token: null });
        assert.strictEqual(denied.status, 401);
        assert.strictEqual(denied.headers.get('cache-control'), 'no-store',
            'even rejected responses must not be cached');
    });

    test('rate limiter 429s with Retry-After once the window budget is spent', async () => {
        // A dedicated app instance keeps this deterministic: the main suite's
        // limiter (2000/min under NODE_ENV=test) must stay untouched.
        const express = require('express');
        const rateLimit = require('../src/middleware/rateLimit');

        const app = express();
        app.use(rateLimit({ windowMs: 60_000, max: 5 }));
        app.get('/ping', (req, res) => res.json({ ok: true }));

        const srv = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        try {
            const url = `http://127.0.0.1:${srv.address().port}/ping`;
            const statuses = [];
            let retryAfterSeen = false;
            for (let i = 0; i < 7; i++) {
                const r = await fetch(url);
                statuses.push(r.status);
                if (r.status === 429 && r.headers.get('retry-after')) retryAfterSeen = true;
            }
            assert.deepStrictEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
            assert.ok(retryAfterSeen, '429 must advertise Retry-After');
        } finally {
            await new Promise((r) => srv.close(r));
        }
    });

    test('patient names are HTML-escaped in the printable report (XSS)', async () => {
        const payload = '<img src=x onerror=alert(1)>';
        const created = await api('/api/patients', {
            method: 'POST',
            body: { name: payload, age: 1, gender: 'Other' },
        });
        assert.strictEqual(created.status, 201);

        const visit = await api('/api/visits', {
            method: 'POST',
            body: { patientId: created.body.data.patientId, testCodes: ['T003'] },
        });
        assert.strictEqual(visit.status, 201);

        const res = await fetch(`${origin}/api/visits/${visit.body.data.id}/report`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        assert.strictEqual(res.status, 200);
        const html = await res.text();

        assert.ok(!html.includes(payload), 'raw markup must never reach the report');
        assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'),
            'the literal text must still be readable after escaping');
    });
});





