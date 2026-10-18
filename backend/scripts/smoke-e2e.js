//
//   Usage: node scripts/smoke-e2e.js        (or: npm run test:smoke)
//
// Boots src/server.js as a child process against a throwaway copy of the
// development database (so no dev data is touched), then walks the whole
// feature surface: health, auth failures, patient CRUD, catalog, visits,
// payment toggle, result entry + auto-complete, printable reports, summary
// aggregation, security headers, and a concurrency burst.
//
// Exits 0 when every check passes, 1 otherwise.
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'smoke-token-0123456789abcdef';
const PORT = 5055;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const TMP_DB = path.join(os.tmpdir(), `clinic-smoke-${process.pid}.db`);

let passed = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) {
        passed += 1;
        console.log(`  ✓ ${name}`);
    } else {
        failures.push(name + (detail ? ` — ${detail}` : ''));
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

async function req(pathname, { method = 'GET', body, token = TOKEN, headers = {} } = {}) {
    const res = await fetch(ORIGIN + pathname, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, headers: res.headers, text, body: json };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForHealth(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${ORIGIN}/api/health`);
            if (res.status === 200) return true;
        } catch { /* not up yet */ }
        await wait(150);
    }
    return false;
}

async function main() {
    fs.copyFileSync(path.join(ROOT, 'prisma', 'clinic.db'), TMP_DB);

    const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
        cwd: ROOT,
        env: {
            ...process.env,
            DATABASE_URL: `file:${TMP_DB}`,
            API_TOKEN: TOKEN,
            PORT: String(PORT),
            NODE_ENV: 'test',   // raises the rate-limit ceiling for the run
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });

    try {
        const up = await waitForHealth();
        if (!up) {
            console.error('Server did not become healthy. Log:\n' + serverLog);
            process.exit(1);
        }

        console.log('\n[1] Health & auth');
        const health = await req('/api/health', { token: null });
        check('GET /api/health is public and 200', health.status === 200 && health.body?.data?.status === 'ok');

        const noTok = await req('/api/patients', { token: null });
        check('protected route without token → 401', noTok.status === 401);
        const badTok = await req('/api/patients', { token: 'wrong-token-aaaaaaaaaaaa' });
        check('wrong token → 401', badTok.status === 401);
        const badHdr = await req('/api/patients', { token: null, headers: { Authorization: 'Basic abc' } });
        check('malformed Authorization header → 401', badHdr.status === 401);

        console.log('\n[2] Patients');
        const p1 = await req('/api/patients', {
            method: 'POST',
            body: { name: 'Smoke Test Patient', age: 35, gender: 'Male', contact: '0300-1234567' },
        });
        check('create patient → 201 with PT- id', p1.status === 201 && /^PT-\d+$/.test(p1.body?.data?.patientId),
            JSON.stringify(p1.body));
        const patient = p1.body.data;

        const badAge = await req('/api/patients', {
            method: 'POST', body: { name: 'X', age: 999, gender: 'Male' },
        });
        check('age out of range → 400', badAge.status === 400);

        const badGender = await req('/api/patients', {
            method: 'POST', body: { name: 'X', age: 20, gender: 'Robot' },
        });
        check('gender not on allow-list → 400', badGender.status === 400);

        const list = await req('/api/patients');
        check('list patients returns array incl. new patient',
            list.status === 200 && Array.isArray(list.body?.data)
            && list.body.data.some((x) => x.id === patient.id));

        const detail = await req(`/api/patients/${patient.id}`);
        check('get patient by id includes visit history', detail.status === 200
            && Array.isArray(detail.body?.data?.visits));

        const missing = await req('/api/patients/does-not-exist');
        check('unknown patient id → 404', missing.status === 404);

        console.log('\n[3] Test catalog');
        const tests = await req('/api/tests');
        const catalog = tests.body?.data || [];
        check('GET /api/tests returns the seeded catalog', tests.status === 200 && catalog.length >= 19);
        const cbc = catalog.find((t) => t.testCode === 'T001');
        check('CBC test exposes 20 fields', !!cbc && cbc.fields.length === 20,
            cbc ? `got ${cbc.fields.length}` : 'T001 missing');
        check('fields carry numeric normal ranges for H/L flagging',
            !!cbc && cbc.fields.some((f) => f.normalMin != null || f.normalMax != null));

        console.log('\n[4] Visits & payment');
        const v1 = await req('/api/visits', {
            method: 'POST',
            body: { patientId: patient.patientId, testCodes: ['T001', 'T006'] },
        });
        check('create visit → 201 with LV- number', v1.status === 201
            && /^LV-\d+$/.test(v1.body?.data?.visitNumber), JSON.stringify(v1.body));
        const visit = v1.body.data;
        const expectedTotal = (catalog.find((t) => t.testCode === 'T001')?.price || 0)
            + (catalog.find((t) => t.testCode === 'T006')?.price || 0);
        check('total snapshots the selected test prices', visit.totalAmount === expectedTotal,
            `got ${visit.totalAmount}, want ${expectedTotal}`);
        check('one record per selected test', visit.records.length === 2);

        const dup = await req('/api/visits', {
            method: 'POST', body: { patientId: patient.patientId, testCodes: ['T006', 'T006'] },
        });
        check('duplicate test codes dedupe to ONE record',
            dup.status === 201 && dup.body?.data?.records?.length === 1);

        const visits = await req('/api/visits');
        check('list visits includes the new visit', visits.status === 200
            && visits.body.data.some((x) => x.id === visit.id));

        const vdetail = await req(`/api/visits/${visit.id}`);
        check('visit detail includes records, fields, values', vdetail.status === 200
            && Array.isArray(vdetail.body?.data?.records)
            && vdetail.body.data.records[0].test.fields.length > 0);
        check('visit starts InProgress / Unpaid',
            vdetail.body.data.status === 'InProgress' && vdetail.body.data.paymentStatus === 'Unpaid');

        const pay = await req(`/api/visits/${visit.id}/payment`, {
            method: 'PUT', body: { paymentStatus: 'Paid' },
        });
        check('mark paid → 200 Paid', pay.status === 200 && pay.body?.data?.paymentStatus === 'Paid');
        const unpay = await req(`/api/visits/${visit.id}/payment`, {
            method: 'PUT', body: { paymentStatus: 'Unpaid' },
        });
        check('mark unpaid → 200 Unpaid', unpay.status === 200 && unpay.body?.data?.paymentStatus === 'Unpaid');
        const badPay = await req(`/api/visits/${visit.id}/payment`, {
            method: 'PUT', body: { paymentStatus: 'Maybe' },
        });
        check('invalid payment status → 400', badPay.status === 400);

        console.log('\n[5] Result entry & visit auto-completion');
        const cbcRecord = visit.records.find((r) => r.test.testCode === 'T001');
        const rec = await req(`/api/visits/records/${cbcRecord.id}`);
        check('get record exposes fields + existing values', rec.status === 200
            && Array.isArray(rec.body?.data?.values));

        // Save a subset first — the visit must NOT complete yet.
        const partialFields = rec.body.data.test.fields.slice(0, 3);
        const partial = await req(`/api/visits/records/${cbcRecord.id}/results`, {
            method: 'PUT',
            body: { values: partialFields.map((f) => ({ fieldId: f.id, value: '5.5' })) },
        });
        check('partial save → 200 saved', partial.status === 200 && partial.body?.data?.saved === true);
        const mid = await req(`/api/visits/${visit.id}`);
        check('visit still InProgress while a sibling record is pending',
            mid.body.data.status === 'InProgress');

        // Wrong-field rejection (field from a different test).
        const widalRec = visit.records.find((r) => r.test.testCode === 'T006');
        const widalFull = await req(`/api/visits/records/${widalRec.id}`);
        const crossField = await req(`/api/visits/records/${cbcRecord.id}/results`, {
            method: 'PUT',
            body: { values: [{ fieldId: widalFull.body.data.test.fields[0].id, value: 'x' }] },
        });
        check('field from another test → 400', crossField.status === 400);

        // Complete the CBC record fully (all 20 fields).
        const allFields = rec.body.data.test.fields;
        const cbcSave = await req(`/api/visits/records/${cbcRecord.id}/results`, {
            method: 'PUT',
            body: { values: allFields.map((f) => ({ fieldId: f.id, value: '10' })) },
        });
        check('full CBC save → 200', cbcSave.status === 200 && cbcSave.body?.data?.saved === true);

        // Complete the sibling record too → the whole visit must flip.
        const widalFields = widalFull.body.data.test.fields;
        const widalSave = await req(`/api/visits/records/${widalRec.id}/results`, {
            method: 'PUT',
            body: { values: widalFields.map((f) => ({ fieldId: f.id, value: 'Negative' })) },
        });
        check('sibling record save → 200', widalSave.status === 200);
        const done = await req(`/api/visits/${visit.id}`);
        check('visit auto-completes when ALL records are done',
            done.body?.data?.status === 'Completed', `status=${done.body?.data?.status}`);

        // Values persisted exactly once (replace, not append).
        const again = await req(`/api/visits/records/${cbcRecord.id}/results`, {
            method: 'PUT',
            body: { values: allFields.map((f) => ({ fieldId: f.id, value: '11' })) },
        });
        const after = await req(`/api/visits/records/${cbcRecord.id}`);
        const valueCount = after.body.data.values.length;
        check('re-save replaces values (no duplicates)',
            again.status === 200 && valueCount === allFields.length,
            `values=${valueCount}, fields=${allFields.length}`);
        check('re-saved value is readable', after.body.data.values.every((v) => v.value === '11'));

        console.log('\n[6] Printable reports');
        const report = await req(`/api/visits/${visit.id}/report`);
        const reportCsp = report.headers.get('content-security-policy') || '';
        check('report → 200 text/html', report.status === 200
            && (report.headers.get('content-type') || '').includes('text/html'));
        check('report carries the RELAXED CSP', !reportCsp.includes("default-src 'none'"));
        check('report shows patient + visit identifiers',
            report.text.includes(patient.patientId) && report.text.includes(visit.visitNumber));
        check('report shows the entered results', report.text.includes('Negative'));
        check('report carries Cache-Control: no-store', report.headers.get('cache-control') === 'no-store');
        check('report forbids framing', report.headers.get('x-frame-options') === 'DENY');

        console.log('\n[7] Period summary (JSON + print)');
        const today = (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
        const summary = await req(`/api/reports/summary?from=${today}&to=${today}`);
        const s = summary.body?.data;
        check('summary → 200 with range/income/visits/patients',
            summary.status === 200 && !!s && !!s.range && !!s.income);
        check("today's summary counts our visit", s.visits.total >= 1);
        check('income splits paid + unpaid consistently',
            Math.abs(s.income.total - (s.income.paid + s.income.unpaid)) < 1e-9);
        const colSum = (s.byDay || []).reduce((n, d) => n + d.income, 0);
        check('byDay income column sums to income.paid', Math.abs(colSum - s.income.paid) < 1e-9,
            `${colSum} vs ${s.income.paid}`);
        check('byTest entries expose name + category', Array.isArray(s.byTest)
            && s.byTest.every((t) => typeof t.name === 'string' && typeof t.category === 'string'));
        check('byCategory entries expose category', Array.isArray(s.byCategory)
            && s.byCategory.every((c) => typeof c.category === 'string'));

        const badRange = await req('/api/reports/summary?from=2020-01-01&to=2026-12-31');
        check('range > 1 year → 400', badRange.status === 400);
        const badDate = await req('/api/reports/summary?from=nope');
        check('invalid date → 400', badDate.status === 400);

        const print = await req(`/api/reports/summary/print?from=${today}&to=${today}`);
        check('summary print → 200 full HTML', print.status === 200 && print.text.includes('</html>'));
        const printCsp = print.headers.get('content-security-policy') || '';
        check('summary print carries relaxed CSP', !printCsp.includes("default-src 'none'"));

        console.log('\n[8] Security headers');
        check('X-Content-Type-Options: nosniff', health.headers.get('x-content-type-options') === 'nosniff');
        check('X-Frame-Options: DENY', health.headers.get('x-frame-options') === 'DENY');
        check('Referrer-Policy: no-referrer', health.headers.get('referrer-policy') === 'no-referrer');
        check('Cache-Control: no-store', health.headers.get('cache-control') === 'no-store');
        check('API CSP is the strict JSON-only policy',
            (health.headers.get('content-security-policy') || '').includes("default-src 'none'"));
        check('x-powered-by suppressed', !health.headers.get('x-powered-by'));

        console.log('\n[9] Concurrency (25 parallel patient creates)');
        const burst = await Promise.all(Array.from({ length: 25 }, (_, i) =>
            req('/api/patients', {
                method: 'POST',
                body: { name: `Burst ${i}`, age: 30, gender: 'Other' },
            })));
        const okIds = burst.filter((r) => r.status === 201).map((r) => r.body.data.patientId);
        check('all 25 succeed', okIds.length === 25, `got ${okIds.length}`);
        check('all 25 IDs unique', new Set(okIds).size === okIds.length);

        const noRoute = await req('/api/nope');
        check('unknown /api path → JSON 404', noRoute.status === 404 && noRoute.body?.success === false);
    } finally {
        server.kill('SIGTERM');
        await wait(400);
        if (!server.killed) server.kill('SIGKILL');
        for (const suffix of ['', '-wal', '-shm']) {
            try { fs.unlinkSync(TMP_DB + suffix); } catch { /* already gone */ }
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    if (failures.length === 0) {
        console.log(`SMOKE PASSED — ${passed} checks green.`);
        process.exit(0);
    }
    console.log(`SMOKE FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
}

main().catch((err) => {
    console.error('Smoke run crashed:', err);
    process.exit(1);
});

