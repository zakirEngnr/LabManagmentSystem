// ============================================================
// tests/frontend.test.js
// Frontend LOGIC tests - zero external dependencies.
//
// The frontend is plain HTML/CSS/JS with no build step and no test
// framework. These tests load the REAL assets/js logic files
// (ui.js, cbc.js) into a tiny in-memory DOM shim on the global
// object, then assert on security-relevant and correctness behaviour:
//   - escapeHtml / badge helpers neutralise XSS payloads,
//   - toast() uses textContent, never innerHTML,
//   - computeFlag() H/L logic and its edge cases,
//   - groupFields / isComplete / firstValue helpers,
//   - money/date formatters.
//
// Run with:  node --test tests/   (from the frontend/ folder)
// ============================================================

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const UI_JS = path.join(__dirname, '..', 'assets', 'js', 'ui.js');
const CBC_JS = path.join(__dirname, '..', 'assets', 'js', 'cbc.js');

// ------------------------------------------------------------
// Minimal DOM shim on the global object.
// ui.js / cbc.js attach themselves to `window` / `document` via
// Object.defineProperty. We provide just enough of the DOM for the
// pure helpers we test. We load the real source ONCE with
// runInThisContext (which reuses Node's main V8 context and does
// not spawn extra contexts).
// ------------------------------------------------------------
function makeClassList(el) {
    return {
        add: (...c) => c.forEach((x) => el._classes.add(x)),
        remove: (...c) => c.forEach((x) => el._classes.delete(x)),
        toggle: (x, force) => {
            if (force === undefined) {
                el._classes.has(x) ? el._classes.delete(x) : el._classes.add(x);
            } else if (force) {
                el._classes.add(x);
            } else {
                el._classes.delete(x);
            }
        },
        contains: (x) => el._classes.has(x),
    };
}

function makeElement(id) {
    const el = {
        id: id || '',
        _classes: new Set(),
        dataset: {},
        children: [],
        value: '',
        textContent: '',
        innerHTML: '',
        disabled: false,
        appendChild(child) { this.children.push(child); return child; },
        remove() {},
        addEventListener() {},
        setAttribute() {},
        getAttribute() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
    };
    el.classList = makeClassList(el);
    return el;
}

const byId = {};
const document = {
    _byId: byId,
    getElementById(id) { return byId[id] || null; },
    createElement() { return makeElement(''); },
    addEventListener() {},
    querySelectorAll() { return []; },
    body: makeElement('body'),
};

const window = { document, location: { search: '' } };
window.window = window;

global.document = document;
global.window = window;

// Load the real frontend logic into the current context.
vm.runInThisContext(fs.readFileSync(UI_JS, 'utf8'), { filename: UI_JS });
vm.runInThisContext(fs.readFileSync(CBC_JS, 'utf8'), { filename: CBC_JS });

const ui = global.window.ui;
const cbc = global.window.cbc;

// Guard: the source files must actually have exported their APIs.
assert.ok(ui, 'ui.js did not attach window.ui');
assert.ok(cbc, 'cbc.js did not attach window.cbc');

// ============================================================
// ui.escapeHtml - the primary XSS defence for HTML-string builds
// ============================================================
test('escapeHtml neutralises script injection', () => {
    const esc = ui.escapeHtml;

    assert.strictEqual(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.ok(!esc('<img src=x onerror=alert(1)>').includes('<img'));
    assert.strictEqual(esc('a & b'), 'a &amp; b');
    assert.strictEqual(esc('" onmouseover="evil'), '&quot; onmouseover=&quot;evil');
    assert.strictEqual(esc("O'Brien"), 'O&#039;Brien');
});

test('escapeHtml handles empty / non-string inputs safely', () => {
    const esc = ui.escapeHtml;

    assert.strictEqual(esc(null), '');
    assert.strictEqual(esc(undefined), '');
    assert.strictEqual(esc(''), '');
    assert.strictEqual(esc(0), '0');
    assert.strictEqual(esc(123), '123');
});

test('badge / paymentBadge / resultBadge escape untrusted text', () => {
    const html = ui.badge('<script>', 'paid');
    assert.ok(!html.includes('<script>'), 'badge must escape the text argument');
    assert.ok(html.includes('&lt;script&gt;'));

    // Kind is also escaped so a hostile status can't break out of the class attr.
    const weird = ui.badge('ok', 'x" onload="evil');
    assert.ok(!weird.includes('" onload'), 'badge must escape the kind argument');

    assert.ok(ui.paymentBadge('Paid').includes('badge-paid'));
    assert.ok(ui.paymentBadge('Unpaid').includes('badge-unpaid'));
    assert.ok(ui.resultBadge('Completed').includes('badge-completed'));
    assert.ok(ui.resultBadge('Pending').includes('badge-pending'));
});

test('toast writes textContent, never innerHTML (no XSS vector)', () => {
    // Pre-create the toast container so getElementById returns it.
    const container = document.createElement('div');
    container.id = 'toastContainer';
    document._byId['toastContainer'] = container;

    const payload = '<img src=x onerror=alert(1)>';
    ui.toast(payload);

    const child = container.children[container.children.length - 1];
    assert.strictEqual(child.textContent, payload, 'payload must be stored as text, not markup');
    assert.notStrictEqual(child.innerHTML, payload);
});

test('money and date formatters behave', () => {
    assert.strictEqual(ui.fmtMoney(1200), 'Rs. 1,200');
    assert.strictEqual(ui.fmtMoney(0), 'Rs. 0');
    assert.strictEqual(ui.fmtMoney(null), 'Rs. 0');
    assert.strictEqual(ui.fmtMoney(undefined), 'Rs. 0');

    assert.strictEqual(ui.fmtDate(''), '');
    assert.strictEqual(ui.fmtDate(null), '');
    assert.strictEqual(ui.fmtDate('not-a-date'), '', 'invalid dates must render empty');
    assert.ok(ui.fmtDate('2026-10-12').length > 0);

    assert.strictEqual(ui.fmtTime(''), '');
    assert.ok(ui.fmtDateTime('2026-10-12T09:30:00.000Z').length > 0);
});

test('getQuery parses the ?id= query string', () => {
    global.window.location.search = '?id=PT-1001&x=1';
    assert.strictEqual(ui.getQuery('id'), 'PT-1001');
    assert.strictEqual(ui.getQuery('missing'), '');
});

// ============================================================
// cbc.computeFlag - abnormal-result flagging (drives H/L badges)
// ============================================================
test('computeFlag marks L / H / blank correctly', () => {
    const f = cbc.computeFlag;

    assert.strictEqual(f('9.2', 12, 17), 'L');   // below min
    assert.strictEqual(f('18', 12, 17), 'H');    // above max
    assert.strictEqual(f('15', 12, 17), '');     // within range
    assert.strictEqual(f('12', 12, 17), '');     // equal to min -> not L
    assert.strictEqual(f('17', 12, 17), '');     // equal to max -> not H
});

test('computeFlag never flags non-numeric or empty input', () => {
    const f = cbc.computeFlag;

    assert.strictEqual(f('', 12, 17), '');
    assert.strictEqual(f('   ', 12, 17), '');
    assert.strictEqual(f('Negative', null, null), '');
    assert.strictEqual(f('Negative', 0, 15), '', 'non-numeric must never produce a flag');
    assert.strictEqual(f(null, 12, 17), '');
    assert.strictEqual(f(undefined, 12, 17), '');
    assert.strictEqual(f('12', null, null), '', 'no bounds -> no flag');
});

test('flagHtml only emits fixed markup for H / L', () => {
    const f = cbc.flagHtml;

    assert.ok(f('H').includes('flag-h') && f('H').includes('>H<'));
    assert.ok(f('L').includes('flag-l') && f('L').includes('>L<'));
    assert.strictEqual(f(''), '');
    assert.strictEqual(f('X'), '');
    assert.strictEqual(f(null), '');
});

// ============================================================
// cbc.groupFields / isCBC / firstValue / isComplete
// ============================================================
test('groupFields partitions CBC fields and buckets leftovers', () => {
    const test = {
        fields: [
            { id: 'a', sortOrder: 0 },
            { id: 'b', sortOrder: 7 },
            { id: 'c', sortOrder: 15 },
            { id: 'd', sortOrder: 99 }, // outside all known ranges
        ],
    };
    const groups = cbc.groupFields(test);
    assert.deepStrictEqual(
        groups.map((g) => g.title),
        ['WBC', 'RBC', 'PLT', 'Other'],
        'fields outside the three ranges must land in a trailing Other group'
    );
    assert.strictEqual(groups.find((g) => g.title === 'Other').fields[0].id, 'd');
    assert.deepStrictEqual(cbc.groupFields(null), []);
    assert.deepStrictEqual(cbc.groupFields({}), []);
});

test('isCBC detects by reportType or test code', () => {
    assert.strictEqual(cbc.isCBC({ reportType: 'CBC_FORM' }), true);
    assert.strictEqual(cbc.isCBC({ testCode: 'T001' }), true);
    assert.strictEqual(cbc.isCBC({ reportType: 'GENERIC' }), false);
    assert.strictEqual(cbc.isCBC(null), false);
});

test('firstValue and isComplete reflect saved results', () => {
    assert.strictEqual(cbc.firstValue({ values: [{ value: 'Negative' }] }), 'Negative');
    assert.strictEqual(cbc.firstValue({ values: [] }), '');
    assert.strictEqual(cbc.firstValue(null), '');

    const test = { fields: [{ id: 'a' }, { id: 'b' }] };
    assert.strictEqual(cbc.isComplete({ test, values: [{ fieldId: 'a', value: '1' }] }), false);
    assert.strictEqual(
        cbc.isComplete({ test, values: [{ fieldId: 'a', value: '1' }, { fieldId: 'b', value: '2' }] }),
        true
    );
    assert.strictEqual(
        cbc.isComplete({ test, values: [{ fieldId: 'a', value: ' ' }, { fieldId: 'b', value: '2' }] }),
        false,
        'whitespace-only values do not count as complete'
    );
});
