// ============================================================
// assets/js/pages/visit.js
// Visit detail: view tests, enter/edit results, print report,
// mark paid.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const visitId = ui.getQuery('id');
    let visit = null;
    let currentRecordId = null;

    // ------------------------------------------------------------
    // RENDER VISIT
    // ------------------------------------------------------------
    function renderVisit() {
        const p = visit.patient;

        $('visitTitle').textContent = `Visit ${visit.visitNumber}`;
        $('visitSubtitle').textContent =
            `${ui.fmtDateTime(visit.visitDate)} · ${ui.fmtMoney(visit.totalAmount)}`;

        // Patient card
        $('patientInfo').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;font-size:13px;">
                <div><strong>Name:</strong> ${ui.escapeHtml(p.name)}</div>
                <div><strong>Patient ID:</strong> ${ui.escapeHtml(p.patientId)}</div>
                <div><strong>Age:</strong> ${p.age} years</div>
                <div><strong>Gender:</strong> ${ui.escapeHtml(p.gender)}</div>
                <div><strong>Contact:</strong> ${ui.escapeHtml(p.contact || '—')}</div>
                <div><strong>Address:</strong> ${ui.escapeHtml(p.address || '—')}</div>
            </div>
        `;

        // Payment badge
        $('visitPaymentBadge').innerHTML = ui.paymentBadge(visit.paymentStatus);

        // Actions
        const allDone = visit.records.every(r => r.resultStatus === 'Completed');
        const actions = `
            ${visit.paymentStatus === 'Unpaid'
                ? `<button class="btn btn-success" onclick="markPaid()"> Mark Paid</button>`
                : `<button class="btn btn-outline" onclick="markUnpaid()">Mark Unpaid</button>`}
            <button class="btn btn-primary" onclick="printReport()">
                 Print Report
            </button>
        `;
        $('visitActions').innerHTML = actions;

        // Record summary
        const doneCount = visit.records.filter(r => r.resultStatus === 'Completed').length;
        $('recordSummary').textContent = `${doneCount} of ${visit.records.length} completed`;

        // Records
        $('recordsList').innerHTML = visit.records.map(r => {
            const isDone = r.resultStatus === 'Completed';
            const includeRangeColumn = (r.test.fields || []).some(f => f.normalMin != null || f.normalMax != null);
            const valuesHtml = isDone && r.values.length
                ? `<table class="values-table" style="width:100%;">
                     <thead><tr><th>Field</th><th>Value</th><th>Unit</th>${includeRangeColumn ? '<th>Range</th>' : ''}</tr></thead>
                     <tbody>
                       ${renderValueRows(r)}
                     </tbody>
                   </table>`
                : '';

            return `
                <div class="record-block">
                    <div class="record-head">
                        <div>
                            <div class="name">${ui.escapeHtml(r.test.testName)}</div>
                            <div class="sub" style="font-size:11px;color:#6b7280;margin-top:2px;">
                                ${ui.escapeHtml(r.test.category)} · Rs. ${r.priceAtVisit}
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            ${ui.resultBadge(r.resultStatus)}
                            <button class="btn ${isDone ? 'btn-outline' : 'btn-primary'} btn-sm"
                                    onclick="openResultEntry('${ui.escapeHtml(r.id)}')">
                                ${isDone ? 'Edit' : 'Enter Results'}
                            </button>
                        </div>
                    </div>
                    ${valuesHtml}
                </div>
            `;
        }).join('');
    }

    function renderValueRows(record) {
        const byId = {};
        record.values.forEach(v => { byId[v.fieldId] = v.value; });
        const includeReferenceRange = record.test.fields.some(f => f.normalMin != null || f.normalMax != null);

        return record.test.fields
            .slice()
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
            .map(f => {
                const val = byId[f.id] || '';
                const flag = cbc.computeFlag(val, f.normalMin, f.normalMax);
                const flagHtml = cbc.flagHtml(flag);
                const rangeCell = includeReferenceRange && (f.normalMin != null || f.normalMax != null)
                    ? `<td style="color:#6b7280;">${ui.escapeHtml(f.normalRange || '')}</td>`
                    : '';
                return `
                    <tr>
                        <td>${ui.escapeHtml(f.fieldName)}</td>
                        <td class="val">${ui.escapeHtml(val || '—')}${flagHtml}</td>
                        <td>${ui.escapeHtml(f.unit || '')}</td>
                        ${rangeCell}
                    </tr>`;
            }).join('');
    }

    // ------------------------------------------------------------
    // LOAD
    // ------------------------------------------------------------
    async function load() {
        if (!visitId) {
            $('visitTitle').textContent = 'Visit not found';
            $('visitSubtitle').textContent = 'No visit ID in URL';
            return;
        }
        try {
            visit = await api.visits.get(visitId);
            renderVisit();
        } catch (err) {
            if (err.status === 401) return;
            $('visitTitle').textContent = 'Visit not found';
            $('visitSubtitle').textContent = err.message || '';
            ui.toast(err.message || 'Failed to load visit', 'error');
        }
    }

    // ------------------------------------------------------------
    // MARK PAID / UNPAID
    // ------------------------------------------------------------
    window.markPaid = async function () {
        try {
            await api.visits.markPaid(visitId, 'Paid');
            ui.toast('Marked as paid', 'success');
            await load();
        } catch (err) { ui.toast(err.message, 'error'); }
    };

    window.markUnpaid = async function () {
        try {
            await api.visits.markPaid(visitId, 'Unpaid');
            ui.toast('Marked as unpaid', 'success');
            await load();
        } catch (err) { ui.toast(err.message, 'error'); }
    };

    // ------------------------------------------------------------
    // PRINT REPORT
    // ------------------------------------------------------------
    window.printReport = async function () {
        try {
            ui.toast('Opening report…', 'success');
            await api.visits.openReport(visitId);
        } catch (err) {
            ui.toast(err.message || 'Failed to open report', 'error');
        }
    };

    // ------------------------------------------------------------
    // RESULT ENTRY
    // ------------------------------------------------------------
    window.openResultEntry = async function (recordId) {
        currentRecordId = recordId;
        try {
            const record = await api.visits.record(recordId);

            $('resultTitle').textContent = record.test.testName;
            $('resultSubtitle').textContent =
                `${record.test.category} · Rs. ${record.priceAtVisit}`;

            // Existing values
            const existing = {};
            record.values.forEach(v => { existing[v.fieldId] = v.value; });

            // Group CBC by WBC/RBC/PLT; other tests in one section
            const groups = cbc.isCBC(record.test)
                ? cbc.groupFields(record.test)
                : [{ title: 'Results', fields: record.test.fields.slice().sort((a,b) => (a.sortOrder||0)-(b.sortOrder||0)) }];

            $('resultForm').innerHTML = groups.map(g => `
                <div class="result-section">
                    <h4>${ui.escapeHtml(g.title)}</h4>
                    ${g.fields.map(f => {
                        const val = existing[f.id] || '';
                        const fieldMeta = [
                            f.unit ? ui.escapeHtml(f.unit) : '',
                            (f.normalMin != null || f.normalMax != null) && f.normalRange ? ui.escapeHtml(f.normalRange) : '',
                        ].filter(Boolean).join(' · ');
                        return `
                            <div class="result-row">
                                <div>
                                    <div class="field-name">${ui.escapeHtml(f.fieldName)}</div>
                                    <div class="field-meta">
                                        ${fieldMeta}
                                    </div>
                                </div>
                                <input type="text"
                                       data-field-id="${ui.escapeHtml(f.id)}"
                                       data-normal-min="${f.normalMin ?? ''}"
                                       data-normal-max="${f.normalMax ?? ''}"
                                       value="${ui.escapeHtml(val)}"
                                       placeholder="value"
                                       oninput="window.__onResultInput(this)">
                                <div class="unit-display">${ui.escapeHtml(f.unit || '')}</div>
                            </div>`;
                    }).join('')}
                </div>
            `).join('');

            animate.modalIn('resultModal');
        } catch (err) {
            ui.toast(err.message || 'Failed to open record', 'error');
        }
    };

    window.closeResultModal = function () { animate.modalOut('resultModal'); };

    // Live H/L preview while typing
    window.__onResultInput = function (input) {
        const val = input.value.trim();
        const min = parseFloat(input.dataset.normalMin);
        const max = parseFloat(input.dataset.normalMax);
        const flag = cbc.computeFlag(val, isNaN(min) ? null : min, isNaN(max) ? null : max);

        // Remove existing flag from the same row
        const row = input.closest('.result-row');
        if (!row) return;
        row.querySelectorAll('.flag').forEach(f => f.remove());

        if (flag) {
            const span = document.createElement('span');
            span.className = 'flag flag-' + flag.toLowerCase();
            span.textContent = flag;
            input.parentElement.appendChild(span);
            animate.pulseFlag(span);
        }
    };

    window.saveResults = async function () {
        if (!currentRecordId) return;

        const inputs = document.querySelectorAll('#resultForm input[data-field-id]');
        const values = Array.from(inputs).map(i => ({
            fieldId: i.dataset.fieldId,
            value: i.value.trim(),
        }));

        const btn = $('saveResultsBtn');
        ui.setLoading(btn, true);

        try {
            await api.visits.saveResults(currentRecordId, values);
            ui.toast('Results saved', 'success');
            closeResultModal();
            await load();
        } catch (err) {
            ui.toast(err.message || 'Failed to save results', 'error');
        } finally {
            ui.setLoading(btn, false);
        }
    };

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    function init() {
        ui.startClock('clock');
        load();
    }

    document.addEventListener('DOMContentLoaded', init);
})();