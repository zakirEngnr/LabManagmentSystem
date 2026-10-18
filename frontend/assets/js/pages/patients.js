// ============================================================
// assets/js/pages/patients.js
// Patient registry: list, search, add new patient.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    let allPatients = [];

    // ------------------------------------------------------------
    // RENDER LIST
    // ------------------------------------------------------------
    function renderPatients() {
        const tbody = $('patientsTableBody');
        const term = $('searchInput').value.trim().toLowerCase();

        const filtered = allPatients.filter(p => {
            if (!term) return true;
            const haystack = [p.name, p.patientId, p.contact || ''].join(' ').toLowerCase();
            return haystack.includes(term);
        });

        $('patientCount').textContent = filtered.length === allPatients.length
            ? `${allPatients.length} patient${allPatients.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${allPatients.length} shown`;

        if (filtered.length === 0) {
            const isEmpty = allPatients.length === 0;
            tbody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <span class="icon">${isEmpty ? '👥' : '🔍'}</span>
                            <div class="title">${isEmpty ? 'No patients yet' : 'No patients match'}</div>
                            ${isEmpty
                                ? 'Click <strong>New Patient</strong> to add your first one.'
                                : 'Try a different search term.'}
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(p => `
            <tr class="clickable" data-patient-id="${ui.escapeHtml(p.id)}" data-patient-code="${ui.escapeHtml(p.patientId)}">
                <td><strong>${ui.escapeHtml(p.patientId)}</strong></td>
                <td>${ui.escapeHtml(p.name)}</td>
                <td>${p.age}</td>
                <td>${ui.escapeHtml(p.gender)}</td>
                <td>${ui.escapeHtml(p.contact || '—')}</td>
                <td class="text-right">${p._count?.visits ?? 0}</td>
            </tr>
        `).join('');

        tbody.querySelectorAll('tr[data-patient-id]').forEach(tr => {
            tr.addEventListener('click', () => {
                const id = tr.getAttribute('data-patient-id');
                window.location.href = './patient.html?id=' + encodeURIComponent(id);
            });
        });
    }

    // ------------------------------------------------------------
    // SKELETON
    // ------------------------------------------------------------
    function showSkeleton() {
        animate.skeletonRows($('patientsTableBody'), 6, 6);
        $('patientCount').textContent = 'Loading…';
    }

    // ------------------------------------------------------------
    // LOAD
    // ------------------------------------------------------------
    async function load() {
        showSkeleton();
        try {
            allPatients = await api.patients.list();
            renderPatients();
        } catch (err) {
            if (err && err.status === 401) return;
            $('patientCount').textContent = 'Failed to load';
            $('patientsTableBody').innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <span class="icon">⚠️</span>
                            <div class="title">Could not load patients</div>
                            ${ui.escapeHtml(err.message || '')}
                        </div>
                    </td>
                </tr>`;
            ui.toast(err.message || 'Failed to load patients', 'error');
        }
    }

    // ------------------------------------------------------------
    // ADD PATIENT
    // ------------------------------------------------------------
    window.openAddPatient = function () {
        $('pName').value = '';
        $('pAge').value = '';
        $('pGender').value = '';
        $('pContact').value = '';
        $('pAddress').value = '';

        animate.modalIn('patientModal');
        setTimeout(() => $('pName').focus(), 100);
    };

    window.closePatientModal = function () {
        animate.modalOut('patientModal');
    };

    window.savePatient = async function () {
        const name = $('pName').value.trim();
        const age = parseInt($('pAge').value, 10);
        const gender = $('pGender').value;
        const contact = $('pContact').value.trim();
        const address = $('pAddress').value.trim();

        if (!name) { ui.toast('Please enter the patient name', 'error'); $('pName').focus(); return; }
        if (isNaN(age) || age < 0 || age > 150) { ui.toast('Please enter a valid age', 'error'); $('pAge').focus(); return; }
        if (!gender) { ui.toast('Please select gender', 'error'); $('pGender').focus(); return; }

        const btn = $('savePatientBtn');
        ui.setLoading(btn, true);

        try {
            const newPatient = await api.patients.create({ name, age, gender, contact, address });

            ui.toast(`Patient ${newPatient.patientId} created`, 'success');
            closePatientModal();

            // Reload list and highlight the new row
            allPatients = await api.patients.list();
            renderPatients();

            // Find and flash the new row using the internal id, not the public patient code.
            const newRow = document.querySelector(`tr[data-patient-id="${newPatient.id}"]`);
            if (newRow) {
                animate.flashRow(newRow, 'new');
                newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

        } catch (err) {
            ui.toast(err.message || 'Failed to save patient', 'error');
        } finally {
            ui.setLoading(btn, false);
        }
    };

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    function init() {
        ui.startClock('clock');

        let searchTimer;
        $('searchInput').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderPatients, 150);
        });

        // Enter key in search = immediate render
        $('searchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchTimer);
                renderPatients();
            }
        });

        load();
    }

    document.addEventListener('DOMContentLoaded', init);
})();