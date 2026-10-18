// src/services/reportService.js
// Generates a print-ready A4 HTML report for a lab visit.
//
// Layout rules
//   - CBC (reportType "CBC_FORM") always gets its own page.
//   - Every other test follows, grouped by category, and flows across as many
//     pages as needed. Tests are never split across a page break, and a
//     category that continues onto the next page repeats its heading.
//   - Letterhead, patient block and footer repeat on every page, and
//     "Page X of Y" is always correct because pages are counted up front.
//   - Abnormal results are readable on a black-and-white printer: the value is
//     bold and the flag is a letter (H solid, L outlined), never colour alone.

// ------------------------------------------------------------
// Page budget (millimetres). The sheet is A4 (297mm); these numbers describe
// how much of it the results table may use. They are deliberately a little
// conservative so a fallback font can never push a row onto a new sheet.
// ------------------------------------------------------------
const BODY_BUDGET_MM = 182;  // usable height for results table rows
const ROW_MM = 7;            // one result row
const DENSE_ROW_MM = 6.6;    // CBC rows (20 fields on one page)
const LINE_MM = 4.2;         // each extra wrapped line inside a row
const BAND_MM = 10;          // category / group heading row
const SUB_MM = 8.5;          // test-name row above a multi-field test
const CHARS_PER_LINE = 16;   // result column width, used to estimate wrapping

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(d) {
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function valueMapOf(record) {
    const map = {};
    (record.values || []).forEach((v) => { map[v.fieldId] = v.value; });
    return map;
}

function sortedFields(test) {
    return (test.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

function hasNumericReferenceRange(field) {
    return !!field && (field.normalMin != null || field.normalMax != null);
}

// ------------------------------------------------------------
// One result row  →  { html, mm }
// ------------------------------------------------------------
function renderFlatRow(name, value, { kind = 'cbc' } = {}) {
    const raw = value == null ? '' : String(value).trim();
    const result = raw
        ? escapeHtml(raw)
        : '<span class="none">—</span>';
    const nameCls = kind === 'cbc' ? 'cbc-name' : 'test-name';
    const valCls = kind === 'cbc' ? 'cbc-value' : 'test-value';
    const rowCls = kind === 'cbc' ? 'cbc-row' : 'test-row';
    const html = `
        <div class="${rowCls}">
            <span class="${nameCls}">${escapeHtml(name)}</span>
            <span class="${valCls}">${result}</span>
        </div>`;
    return { html, mm: 6 };
}

function renderBand(title, continued = false, columnCount = 5) {
    return `
            <tr class="band">
                <th colspan="${columnCount}">${escapeHtml(title)}${
                    continued ? '<span class="cont">continued</span>' : ''
                }</th>
            </tr>`;
}

const TABLE_HEAD_WITH_REF = `
        <colgroup>
            <col style="width:32%"><col style="width:20%"><col style="width:14%">
            <col style="width:26%"><col style="width:8%">
        </colgroup>
        <thead>
            <tr>
                <th class="h-lbl">Test</th>
                <th class="h-res">Result</th>
                <th class="h-unit">Unit</th>
                <th class="h-ref">Reference range</th>
                <th class="h-flg">Flag</th>
            </tr>
        </thead>`;

const TABLE_HEAD_NO_REF = `
        <colgroup>
            <col style="width:36%"><col style="width:26%"><col style="width:18%"><col style="width:20%">
        </colgroup>
        <thead>
            <tr>
                <th class="h-lbl">Test</th>
                <th class="h-res">Result</th>
                <th class="h-unit">Unit</th>
                <th class="h-flg">Flag</th>
            </tr>
        </thead>`;

function renderTable(rowsHtml, { dense = false, includeReferenceRange = true } = {}) {
    const head = includeReferenceRange ? TABLE_HEAD_WITH_REF : TABLE_HEAD_NO_REF;
    return `
        <table class="results${dense ? ' dense' : ''}">${head}
        <tbody>${rowsHtml}
        </tbody>
        </table>`;
}

// ------------------------------------------------------------
// CBC page — WBC / RBC / PLT groups (fields are ordered 0-6, 7-14, 15-19)
// ------------------------------------------------------------
const CBC_GROUPS = [
    { title: 'White blood cells (WBC)', from: 0, to: 7 },
    { title: 'Red blood cells (RBC)', from: 7, to: 15 },
    { title: 'Platelets (PLT)', from: 15, to: 20 },
];

function renderCBCPage(record) {
    const fields = sortedFields(record.test);
    const values = valueMapOf(record);

    let rows = '';
    for (const f of fields) {
        rows += renderFlatRow(f.fieldName, values[f.id], { kind: 'cbc' }).html;
    }

    return `
        <h2 class="page-title">Complete blood count</h2>
        <div class="cbc-section">${rows}</div>`;
}

// ------------------------------------------------------------
// Other tests — turned into unbreakable blocks, then paginated
// ------------------------------------------------------------
function buildBlocks(records) {
    return records.map((r) => {
        const fields = sortedFields(r.test);
        const values = valueMapOf(r);

        let html = `<div class="test-group"><div class="test-name">${escapeHtml(r.test.testName)}</div>`;
        let mm = 8;
        if (!fields.length) {
            html += `<div class="test-row"><span class="test-name">No fields defined</span><span class="test-value">—</span></div>`;
            mm += 6;
        }
        for (const f of fields) {
            const row = renderFlatRow(f.fieldName, values[f.id], { kind: 'test' });
            html += row.html;
            mm += row.mm;
        }
        html += `</div>`;
        return { group: r.test.category || 'Other', html, mm };
    });
}

function paginate(blocks) {
    const pages = [];
    let cur = null;

    for (const b of blocks) {
        if (cur && cur.used + b.mm > BODY_BUDGET_MM) {
            pages.push(cur.rows);
            cur = null;
        }
        if (!cur) {
            cur = { rows: '', used: 0 };
        }
        cur.rows += b.html;
        cur.used += b.mm;
    }
    if (cur) pages.push(cur.rows);

    return pages.map((rows) => `<div class="results-page">${rows}</div>`);
}

// ------------------------------------------------------------
// Page wrapper: letterhead + patient block + body + footer
// ------------------------------------------------------------
const MARK_SVG = `
<svg class="mark" viewBox="0 0 40 40" width="42" height="42" aria-hidden="true">
    <rect width="40" height="40" rx="9" fill="#12343b"/>
    <path d="M20 8C24.5 14 29 18.2 29 23.2a9 9 0 0 1-18 0C11 18.2 15.5 14 20 8z" fill="#ffffff"/>
    <path d="M20 19v8M16 23h8" stroke="#12343b" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

function wrapPage(body, { patient, visit, pageNum, totalPages, printedOn }) {
    return `
    <section class="sheet">
        <header class="report-header">
            <div class="report-logo">
                <img src="http://localhost:5000/assets/img/logo.png" alt=""
                     onerror="this.style.display='none'">
            </div>
            <div class="report-title">
                <h1>Arham Diagnostic Laboratory</h1>
                <div class="sub">Lab Tech. 0333 2430075 · Shalbandi Distt: Buner</div>
            </div>
        </header>

        <div class="patient">
            <div class="cell c-name"><span class="k">Patient name</span><span class="v">${escapeHtml(patient.name)}</span></div>
            <div class="cell"><span class="k">Patient ID</span><span class="v">${escapeHtml(patient.patientId)}</span></div>
            <div class="cell"><span class="k">Visit no.</span><span class="v">${escapeHtml(visit.visitNumber)}</span></div>
            <div class="cell"><span class="k">Age / gender</span><span class="v">${escapeHtml(patient.age)} / ${escapeHtml(patient.gender)}</span></div>
            <div class="cell"><span class="k">Date</span><span class="v">${escapeHtml(formatDate(visit.visitDate))}</span></div>
        </div>

        <main class="body">${body}
        </main>

        <footer class="report-footer">
            <div class="footer-services">
                We also offer: TFTs · Free TFTs · Anticip · ANA · Cross Match and other specialized tests
            </div>
            <div class="footer-disclaimer">
                This is a computer-generated report. Signature not required.
            </div>
            <div class="footer-page">Page ${pageNum} of ${totalPages}</div>
        </footer>
    </section>`;
}

// ------------------------------------------------------------
// Styles
// ------------------------------------------------------------
const STYLES = `
    :root {
        --ink: #12343b;
        --accent: #137a82;
        --text: #152024;
        --muted: #5b6b70;
        --rule: #cfd9dc;
        --hair: #e4eaec;
        --tint: #f2f6f7;
        --high: #b42318;
        --low: #1d4ed8;
        --sans: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
        --serif: Georgia, "Times New Roman", Times, serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body {
        font-family: var(--sans);
        color: var(--text);
        background: #dde4e6;
        padding: 24px 12px 40px;
    }

    @page { size: A4; margin: 0; }

    /* ---------- Sheet ---------- */
    .sheet {
        position: relative;
        width: 210mm;
        min-height: 296mm;
        margin: 0 auto 22px;
        padding: 10mm 14mm 9mm;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
        display: flex;
        flex-direction: column;
    }

    /* ---------- Letterhead ---------- */
    .mast {
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        padding-bottom: 4mm;
        margin-bottom: 5mm;
        border-bottom: 2pt solid var(--ink);
    }
    .mast::after {
        content: "";
        position: absolute;
        left: 0; bottom: -2pt;
        width: 30mm; height: 2pt;
        background: var(--accent);
    }
    .mast .id { display: flex; align-items: center; gap: 4mm; }
    .mark { flex: none; display: block; }
    img.mark { height: 11mm; width: 11mm; border-radius: 50%; }
    .name {
        font-family: var(--serif);
        font-size: 21pt;
        font-weight: 700;
        line-height: 1.1;
        color: var(--ink);
    }
    .mast .meta {
        font-size: 8.5pt;
        color: var(--muted);
        margin-top: 0.8mm;
        line-height: 1.25;
    }
    .doc { text-align: right; }
    .doc-title {
        font-family: var(--serif);
        font-size: 14pt;
        font-style: italic;
        color: var(--ink);
        line-height: 1.1;
    }
    .doc-sub {
        font-size: 11pt;
        font-weight: 700;
        color: var(--accent);
        margin-top: 1mm;
        font-variant-numeric: tabular-nums;
    }

    .report-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        border-bottom: 3px solid #1e3a8a;
        padding-bottom: 10px;
        margin-bottom: 16px;
        text-align: left;
    }
    .report-header .report-logo img {
        height: 64px;
        width: auto;
        display: block;
    }
    .report-header .report-title { flex: 1; }
    .report-header h1 {
        font-size: 24px;
        color: #1e3a8a;
        letter-spacing: 0.5px;
        margin: 0;
    }
    .report-header .sub {
        font-size: 13px;
        color: #374151;
        margin-top: 4px;
    }

    /* ---------- Patient block ---------- */
    .patient {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr;
        gap: 3mm 6mm;
        padding: 3.5mm 4mm;
        margin-bottom: 6mm;
        background: var(--tint);
        border-left: 2.2pt solid var(--ink);
    }
    .cell { display: flex; flex-direction: column; min-width: 0; }
    .cell .k { font-size: 7.5pt; color: var(--muted); line-height: 1.2; }
    .cell .v {
        font-size: 10.5pt;
        font-weight: 600;
        line-height: 1.3;
        margin-top: 0.4mm;
        overflow-wrap: anywhere;
        font-variant-numeric: tabular-nums;
    }

    /* ---------- Body ---------- */
    .body { flex: 1 1 auto; }
    .page-title {
        font-family: var(--serif);
        font-size: 15pt;
        font-weight: 700;
        color: var(--ink);
        margin-bottom: 3mm;
    }

    table.results {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        font-size: 9.5pt;
        font-variant-numeric: tabular-nums;
    }
    .results thead th {
        font-size: 7.5pt;
        font-weight: 600;
        color: var(--muted);
        text-align: left;
        padding: 0 0 1.4mm;
        border-bottom: 0.75pt solid var(--rule);
        height: 7mm;
        vertical-align: bottom;
    }
    .results thead .h-res { text-align: right; padding-right: 2mm; }
    .results thead .h-unit { padding-left: 2mm; }
    .results thead .h-flg { text-align: center; }

    /* Category / group heading */
    .results tr.band th {
        height: 10mm;
        padding: 4mm 0 1mm;
        vertical-align: bottom;
        text-align: left;
        font-family: var(--serif);
        font-size: 11.5pt;
        font-weight: 700;
        color: var(--ink);
        border-bottom: 1.4pt solid var(--ink);
    }
    .results tbody tr.band:first-child th { padding-top: 1.5mm; }
    .results tr.band .cont {
        margin-left: 2.5mm;
        font-family: var(--sans);
        font-size: 7.5pt;
        font-weight: 400;
        font-style: italic;
        color: var(--muted);
    }

    /* Test name above a multi-field test */
    .results tr.sub td {
        height: 8.5mm;
        padding-top: 2.5mm;
        font-weight: 700;
        color: var(--ink);
        vertical-align: middle;
    }

    /* Result rows */
    .results tr.row td {
        height: 7mm;
        padding-top: 0;
        padding-bottom: 0;
        vertical-align: middle;
        border-bottom: 0.5pt solid var(--hair);
    }
    .results.dense tr.row td { height: 6.6mm; }
    .results td.lbl { font-weight: 600; }
    .results tr.indent td.lbl { padding-left: 3.5mm; font-weight: 500; }
    .results td.res {
        text-align: right;
        padding-right: 2mm;
        font-weight: 700;
        font-size: 10pt;
        overflow-wrap: anywhere;
    }
    .results td.res .none { font-weight: 400; color: var(--muted); }
    .results td.unit { padding-left: 2mm; font-size: 8.5pt; color: var(--muted); }
    .results td.ref { font-size: 8.5pt; color: var(--muted); }
    .results td.flg { text-align: center; }
    .results td.none { color: var(--muted); font-style: italic; }

    .empty { margin-top: 20mm; text-align: center; color: var(--muted); font-style: italic; }

    /* ---------- Footer ---------- */
    .report-footer {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid #1e3a8a;
        font-size: 11px;
        color: #4b5563;
        text-align: center;
        line-height: 1.5;
    }
    .report-footer .footer-services { margin-bottom: 4px; font-size: 11px; }
    .report-footer .footer-disclaimer {
        color: #6b7280; font-size: 10px; font-style: italic;
        margin-bottom: 4px;
    }
    .report-footer .footer-page { font-size: 10px; color: #9ca3af; }

    /* ---------- Flat result rows ---------- */
    .cbc-row, .test-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        padding: 3px 0;
        border-bottom: 1px dotted #d1d5db;
    }
    .cbc-name, .test-name { font-weight: 500; }
    .cbc-value, .test-value { font-weight: 600; }

    /* ---------- Toolbar (screen only) ---------- */
    .toolbar {
        position: fixed;
        top: 14px; right: 14px;
        display: flex;
        gap: 8px;
        z-index: 100;
    }
    .toolbar button {
        font: 600 13px var(--sans);
        padding: 9px 16px;
        border-radius: 8px;
        border: 1px solid var(--ink);
        background: var(--ink);
        color: #fff;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }
    .toolbar button.secondary { background: #fff; color: var(--ink); border-color: var(--rule); }
    .toolbar button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

    /* Narrow screens: shrink the whole sheet instead of scrolling sideways */
    @media screen and (max-width: 860px) { .sheet { zoom: .75; } }
    @media screen and (max-width: 660px) { .sheet { zoom: .52; } .toolbar { top: 8px; right: 8px; } }
    @media screen and (max-width: 440px) { .sheet { zoom: .4; } }

    /* ---------- Print ---------- */
    @media print {
        body { background: #fff; padding: 0; }
        .toolbar { display: none; }
        .sheet {
            margin: 0;
            box-shadow: none;
            zoom: 1;
            break-after: page;
            page-break-after: always;
        }
        .sheet:last-of-type { break-after: auto; page-break-after: auto; }
        .report-footer { page-break-inside: avoid; }
    }
`;

// ------------------------------------------------------------
// MAIN: build the full report HTML
// ------------------------------------------------------------
function buildReportHTML(visit) {
    const records = visit.records || [];
    const cbcRecords = records.filter((r) => r.test.reportType === 'CBC_FORM');
    const otherRecords = records.filter((r) => r.test.reportType !== 'CBC_FORM');

    const pages = [];

    // CBC first: one page per CBC record (normally just one)
    for (const rec of cbcRecords) pages.push(renderCBCPage(rec));

    // Everything else flows across as many pages as it needs
    if (otherRecords.length) pages.push(...paginate(buildBlocks(otherRecords)));

    if (!pages.length) pages.push('<p class="empty">No tests on this visit.</p>');

    const totalPages = pages.length;
    const printedOn = formatDate(new Date());

    const sheets = pages
        .map((body, i) => wrapPage(body, {
            patient: visit.patient,
            visit,
            pageNum: i + 1,
            totalPages,
            printedOn,
        }))
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report ${escapeHtml(visit.visitNumber)} — ${escapeHtml(visit.patient.name)}</title>
<style>${STYLES}</style>
</head>
<body>

<div class="toolbar">
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
    <button type="button" class="secondary" onclick="window.close()">Close</button>
</div>

${sheets}

<script>
    // Open the print dialog once the page has finished loading.
    window.addEventListener('load', function () {
        setTimeout(function () { window.print(); }, 400);
    });
</script>

</body>
</html>`;
}
// ============================================================
// REPORT SUMMARY — for the Reports page
// ============================================================

function fmtMoney(n) {
    return 'Rs. ' + Number(n || 0).toLocaleString('en-IN');
}

function fmtDateLong(dateStr) {
    // No trailing Z → parsed as LOCAL midnight, so the label matches the
    // LOCAL-day bucketing done in reportController (toISOString bucketing
    // used to shift boundary days by one in UTC+x timezones).
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function buildReportSummaryHTML(summary) {
    const { range, income, visits, patients, byTest, byCategory, byDay, topPatients } = summary;

    const pageTitle = range.from === range.to
        ? `Report — ${fmtDateLong(range.from)}`
        : `Report — ${fmtDateLong(range.from)} to ${fmtDateLong(range.to)}`;

    const incomeRows = `
        <div class="row"><span class="lbl">Total Visits</span><span class="dots"></span><span class="val">${visits.total}</span></div>
        <div class="row"><span class="lbl">Completed</span><span class="dots"></span><span class="val">${visits.completed}</span></div>
        <div class="row"><span class="lbl">Pending</span><span class="dots"></span><span class="val">${visits.pending}</span></div>
        <div class="row"><span class="lbl">Unique Patients</span><span class="dots"></span><span class="val">${patients.unique}</span></div>
        <div class="row"><span class="lbl">New Patients</span><span class="dots"></span><span class="val">${patients.new}</span></div>
        <div class="row"><span class="lbl">Returning Patients</span><span class="dots"></span><span class="val">${patients.returning}</span></div>
        <div class="row total"><span class="lbl">Total Income</span><span class="dots"></span><span class="val">${fmtMoney(income.total)}</span></div>
        <div class="row"><span class="lbl">Paid</span><span class="dots"></span><span class="val">${fmtMoney(income.paid)}</span></div>
        <div class="row"><span class="lbl">Unpaid</span><span class="dots"></span><span class="val">${fmtMoney(income.unpaid)}</span></div>
    `;

    const showByDay = byDay.length > 1;
    const byDaySection = showByDay ? `
        <div class="section-title">INCOME BY DAY</div>
        <table class="data-table">
            <thead>
                <tr><th>Date</th><th class="num">Visits</th><th class="num">Income</th></tr>
            </thead>
            <tbody>
                ${byDay.map(d => `
                    <tr>
                        <td>${fmtDateLong(d.date)}</td>
                        <td class="num">${d.visits}</td>
                        <td class="num">${fmtMoney(d.income)}</td>
                    </tr>
                `).join('')}
                <tr class="totals-row">
                    <td><strong>TOTAL</strong></td>
                    <td class="num"><strong>${visits.total}</strong></td>
                    <td class="num"><strong>${fmtMoney(income.paid)}</strong></td>
                </tr>
            </tbody>
        </table>
    ` : '';

    const testSection = byTest.length ? `
        <div class="section-title">TESTS PERFORMED</div>
        <table class="data-table">
            <thead>
                <tr><th>Test</th><th>Category</th><th class="num">Count</th><th class="num">Total</th></tr>
            </thead>
            <tbody>
                ${byTest.map(t => `
                    <tr>
                        <td>${escapeHtml(t.name)}</td>
                        <td>${escapeHtml(t.category)}</td>
                        <td class="num">${t.count}</td>
                        <td class="num">${fmtMoney(t.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '';

    const catSection = byCategory.length ? `
        <div class="section-title">CATEGORY BREAKDOWN</div>
        <table class="data-table">
            <thead>
                <tr><th>Category</th><th class="num">Count</th><th class="num">Total</th></tr>
            </thead>
            <tbody>
                ${byCategory.map(c => `
                    <tr>
                        <td>${escapeHtml(c.category || '—')}</td>
                        <td class="num">${c.count}</td>
                        <td class="num">${fmtMoney(c.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '';

    const topSection = topPatients.length ? `
        <div class="section-title">TOP PATIENTS</div>
        <table class="data-table">
            <thead>
                <tr><th>#</th><th>Patient</th><th class="num">Visits</th><th class="num">Paid</th></tr>
            </thead>
            <tbody>
                ${topPatients.map((p, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${escapeHtml(p.name)} <span class="muted">(${escapeHtml(p.patientId)})</span></td>
                        <td class="num">${p.visits}</td>
                        <td class="num">${fmtMoney(p.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(pageTitle)}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Times New Roman', Times, serif;
        background: #e5e7eb;
        color: #000;
        padding: 20px;
    }

    .report-page {
        background: white;
        width: 210mm;
        min-height: 250mm;
        margin: 0 auto 20px;
        padding: 15mm;
        box-shadow: 0 2px 10px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
    }

    .report-content {
        flex: 1;
    }

    .report-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        border-bottom: 3px solid #1e3a8a;
        padding-bottom: 10px;
        margin-bottom: 16px;
        text-align: left;
    }
    .report-header .report-logo img {
        height: 64px;
        width: auto;
        display: block;
    }
    .report-header .report-title { flex: 1; }
    .report-header h1 {
        font-size: 24px;
        color: #1e3a8a;
        letter-spacing: 0.5px;
        margin: 0;
    }
    .report-header .sub {
        font-size: 13px;
        color: #374151;
        margin-top: 4px;
    }
    .report-header .range {
        font-size: 15px;
        font-weight: bold;
        color: #1e3a8a;
        text-align: right;
        flex: none;
    }

    .section-title {
        background: #1e3a8a;
        color: white;
        text-align: center;
        font-size: 12px;
        font-weight: bold;
        padding: 4px 8px;
        letter-spacing: 1px;
        margin: 18px 0 10px;
    }

    .row {
        display: flex;
        align-items: baseline;
        font-size: 13px;
        padding: 3px 0;
    }
    .row.total {
        font-weight: bold;
        font-size: 14px;
        border-top: 1px solid #999;
        padding-top: 6px;
        margin-top: 4px;
    }
    .row .lbl { min-width: 180px; }
    .row .dots {
        flex: 1;
        border-bottom: 1px dotted #999;
        height: 1px;
        margin: 0 8px;
        position: relative;
        top: -3px;
    }
    .row .val {
        min-width: 100px;
        text-align: right;
        font-weight: 600;
    }

    .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        margin-bottom: 8px;
    }
    .data-table th,
    .data-table td {
        border: 1px solid #d1d5db;
        padding: 5px 8px;
        text-align: left;
    }
    .data-table th {
        background: #f3f4f6;
        font-weight: bold;
        font-size: 11px;
        text-transform: uppercase;
        color: #374151;
    }
    .data-table td.num,
    .data-table th.num {
        text-align: right;
    }
    .data-table .totals-row td {
        background: #f9fafb;
        border-top: 2px solid #1e3a8a;
    }
    .muted { color: #6b7280; font-size: 11px; }

    .report-footer {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid #1e3a8a;
        font-size: 11px;
        color: #4b5563;
        text-align: center;
        line-height: 1.5;
    }
    .report-footer .footer-services { margin-bottom: 4px; font-size: 11px; }
    .report-footer .footer-disclaimer {
        color: #6b7280; font-size: 10px; font-style: italic;
        margin-bottom: 4px;
    }
    .report-footer .footer-page { font-size: 10px; color: #9ca3af; }

    /* ---------- Flat result rows ---------- */
    .cbc-row, .test-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        padding: 3px 0;
        border-bottom: 1px dotted #d1d5db;
    }
    .cbc-name, .test-name { font-weight: 500; }
    .cbc-value, .test-value { font-weight: 600; }

    @media print {
        body { background: white; padding: 0; }
        .report-page {
            width: auto;
            min-height: auto;
            margin: 0;
            padding: 15mm 12mm;
            box-shadow: none;
        }
        .toolbar { display: none; }
        .report-footer { page-break-inside: avoid; }
    }

    .toolbar {
        position: fixed;
        top: 12px; right: 12px;
        display: flex;
        gap: 8px;
        z-index: 100;
    }
    .toolbar button {
        padding: 9px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        background: #2563eb;
        color: white;
    }
    .toolbar button.secondary { background: white; color: #1f2937; border: 1px solid #d1d5db; }
</style>
</head>
<body>

<div class="toolbar">
    <button onclick="window.print()">🖨️ Print / Save as PDF</button>
    <button class="secondary" onclick="window.close()">Close</button>
</div>

<div class="report-page">
    <div class="report-header">
        <div class="report-logo">
            <img src="http://localhost:5000/assets/img/logo.png" alt="" onerror="this.style.display='none'">
        </div>
        <div class="report-title">
            <h1>Arham Diagnostic Laboratory</h1>
            <div class="sub">Lab Tech. 0333 2430075 · Shalbandi Distt: Buner</div>
        </div>
    </div>

    <div class="report-content">
    <div class="section-title">SUMMARY</div>
    ${incomeRows}

    ${byDaySection}
    ${testSection}
    ${catSection}
    ${topSection}
    </div>

    <div class="report-footer">
        <div class="footer-services">
            We also offer: TFTs · Free TFTs · Anticip · ANA · Cross Match and other specialized tests
        </div>
        <div class="footer-disclaimer">
            This is a computer-generated report. Signature not required.
        </div>
        <div class="footer-page">Generated: ${new Date().toLocaleString('en-GB')}</div>
    </div>
</div>

<script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 400));
</script>

</body>
</html>`;
}

module.exports = { buildReportHTML, buildReportSummaryHTML };