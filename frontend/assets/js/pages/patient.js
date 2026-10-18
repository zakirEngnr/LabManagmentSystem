// ============================================================
// assets/js/pages/patient.js
// Patient profile with details + full visit history.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const patientId = ui.getQuery('id');
    let patient = null;

    function renderPatient() {
        const p = patient;

        $('patientTitle').textContent = p.name;
        $('patientSubtitle').textContent =
            `${p.patientId} · ${p.age}y · ${p.gender}`;

        $('patientDetails').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;font-size:13px;">
                <div><strong>Patient ID:</strong> ${ui.escapeHtml(p.patientId)}</div>
                <div><strong>Name:</strong> ${ui.escapeHtml(p.name)}</div>
                <div><strong>Age:</strong> ${p.age} years</div>
                <div><strong>Gender:</strong> ${ui.escapeHtml(p.gender)}</div>
                <div><strong>Contact:</strong> ${ui.escapeHtml(p.contact || '—')}</div>
                <div><strong>Address:</strong> ${ui.escapeHtml(p.address || '—')}</div>
                <div style="grid-column:1/-1;"><strong>Medical History:</strong> ${ui.escapeHtml(p.medicalHistory || '—')}</div>
                <div style="grid-column:1/-1;"><strong>Registered:</strong> ${ui.fmtDateTime(p.createdAt)}</div>
            </div>
        `;

        const visits = p.visits || [];
        $('visitCount').textContent = `${visits.length} visit${visits.length === 1 ? '' : 's'}`;

        const tbody = $('visitHistoryBody');
        if (visits.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <span class="icon">📋</span>
                            <div class="title">No visits yet</div>
                            Create a <strong>New Visit</strong> for this patient.
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = visits.map(v => {
            const testNames = v.records.map(r => r.test.shortName || r.test.testName).join(', ');
            const allDone = v.records.every(r => r.resultStatus === 'Completed');
            return `
                <tr class="clickable" data-visit-id="${ui.escapeHtml(v.id)}">
                    <td><strong>${ui.escapeHtml(v.visitNumber)}</strong></td>
                    <td>${ui.fmtDateTime(v.visitDate)}</td>
                    <td>${ui.escapeHtml(testNames)}</td>
                    <td class="text-right">${ui.fmtMoney(v.totalAmount)}</td>
                    <td>${ui.paymentBadge(v.paymentStatus)}</td>
                    <td>${ui.resultBadge(allDone ? 'Completed' : 'Pending')}</td>
                </tr>`;
        }).join('');

        tbody.querySelectorAll('tr[data-visit-id]').forEach(tr => {
            tr.addEventListener('click', () => {
                const id = tr.getAttribute('data-visit-id');
                window.location.href = './visit.html?id=' + encodeURIComponent(id);
            });
        });
    }

    async function load() {
        if (!patientId) {
            $('patientTitle').textContent = 'Patient not found';
            $('patientSubtitle').textContent = 'No patient ID in URL';
            return;
        }
        try {
            try {
                patient = await api.patients.get(patientId);
            } catch (err) {
                // Some links still pass the public patient code (PT-1001) instead of
                // the internal Prisma id. Fall back to resolving the code from the list.
                if (err && err.status !== 404) throw err;
                const list = await api.patients.list();
                const match = list.find((p) => p.patientId === patientId);
                if (!match) throw err;
                patient = await api.patients.get(match.id);
            }
            renderPatient();
        } catch (err) {
            if (err && err.status === 401) return;
            $('patientTitle').textContent = 'Patient not found';
            $('patientSubtitle').textContent = err && err.message ? err.message : '';
            ui.toast(err && err.message ? err.message : 'Failed to load patient', 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        ui.startClock('clock');
        load();
    });
})();