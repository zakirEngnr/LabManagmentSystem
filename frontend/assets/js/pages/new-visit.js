// ============================================================
// assets/js/pages/new-visit.js
// New Visit workflow: pick patient, choose tests, create.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    let allPatients = [];
    let allTests = [];
    let selectedTests = new Set();
    let selectedPatient = null;

    // ------------------------------------------------------------
    // PATIENTS
    // ------------------------------------------------------------
    async function loadPatients() {
        try { allPatients = await api.patients.list(); }
        catch (err) { if (err.status !== 401) ui.toast(err.message, 'error'); }
    }

    function searchPatients(term) {
        if (!term) return [];
        const t = term.toLowerCase();
        return allPatients.filter(p =>
            p.name.toLowerCase().includes(t) ||
            p.patientId.toLowerCase().includes(t) ||
            (p.contact || '').toLowerCase().includes(t)
        ).slice(0, 8);
    }

    function renderPatientResults(term) {
        const box = $('patientResults');
        if (!term) { box.classList.add('hidden'); return; }

        const results = searchPatients(term);
        if (results.length === 0) {
            box.innerHTML = `<div class="result"><div class="name text-muted">No matches</div></div>`;
            box.classList.remove('hidden');
            return;
        }

        box.innerHTML = results.map(p => `
            <div class="result" data-patient-id="${ui.escapeHtml(p.patientId)}">
                <div class="name">${ui.escapeHtml(p.name)}</div>
                <div class="meta">${ui.escapeHtml(p.patientId)} · ${p.age}y · ${ui.escapeHtml(p.gender)}${p.contact ? ' · ' + ui.escapeHtml(p.contact) : ''}</div>
            </div>
        `).join('');
        box.classList.remove('hidden');

        box.querySelectorAll('.result[data-patient-id]').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-patient-id');
                const patient = allPatients.find(p => p.patientId === id);
                if (patient) pickPatient(patient);
            });
        });
    }

    function pickPatient(p) {
        selectedPatient = p;
        $('pickedName').textContent = p.name;
        $('pickedMeta').textContent = `${p.patientId} · ${p.age}y · ${p.gender}${p.contact ? ' · ' + p.contact : ''}`;
        $('pickedPatient').classList.remove('hidden');
        $('patientSearchBox').classList.add('hidden');
        $('patientResults').classList.add('hidden');
        $('patientSearch').value = '';
        updateCreateButton();
    }

    window.clearPatient = function () {
        selectedPatient = null;
        $('pickedPatient').classList.add('hidden');
        $('patientSearchBox').classList.remove('hidden');
        $('patientSearch').value = '';
        $('patientResults').classList.add('hidden');
        updateCreateButton();
    };

    // ------------------------------------------------------------
    // ADD PATIENT MODAL
    // ------------------------------------------------------------
    window.openAddPatient = function () {
        ['pName','pAge','pContact','pAddress'].forEach(id => $(id).value = '');
        $('pGender').value = '';
        animate.modalIn('patientModal');
        setTimeout(() => $('pName').focus(), 100);
    };

    window.closePatientModal = function () { animate.modalOut('patientModal'); };

    window.savePatient = async function () {
        const name = $('pName').value.trim();
        const age = parseInt($('pAge').value, 10);
        const gender = $('pGender').value;
        const contact = $('pContact').value.trim();
        const address = $('pAddress').value.trim();

        if (!name) { ui.toast('Please enter the patient name', 'error'); return; }
        if (isNaN(age) || age < 0 || age > 150) { ui.toast('Please enter a valid age', 'error'); return; }
        if (!gender) { ui.toast('Please select gender', 'error'); return; }

        const btn = $('savePatientBtn');
        ui.setLoading(btn, true);
        try {
            const newPatient = await api.patients.create({ name, age, gender, contact, address });
            ui.toast(`Patient ${newPatient.patientId} created`, 'success');
            closePatientModal();
            await loadPatients();
            pickPatient(newPatient);
        } catch (err) {
            ui.toast(err.message || 'Failed to save patient', 'error');
        } finally {
            ui.setLoading(btn, false);
        }
    };

    // ------------------------------------------------------------
    // TESTS
    // ------------------------------------------------------------
    async function loadTests() {
        try {
            allTests = await api.tests.list();
            renderTests();
        } catch (err) {
            if (err.status !== 401) ui.toast(err.message, 'error');
            $('testGrid').innerHTML = `<div class="empty-state"><span class="icon">⚠️</span>Failed to load tests</div>`;
        }
    }

    function renderTests() {
        $('testCount').textContent = `${allTests.length} tests available`;
        $('testGrid').innerHTML = allTests.map(t => {
            const checked = selectedTests.has(t.testCode);
            return `
                <label class="test-checkbox ${checked ? 'selected' : ''}">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                           onchange="window.__toggleTest('${ui.escapeHtml(t.testCode)}', this.checked)">
                    <span class="test-name">${ui.escapeHtml(t.shortName || t.testName)}</span>
                    <span class="test-price">Rs. ${t.price}</span>
                </label>
            `;
        }).join('');
    }

    window.__toggleTest = function (code, checked) {
        if (checked) selectedTests.add(code);
        else selectedTests.delete(code);
        updateTotal();
        // Toggle the "selected" class on the parent label without a full re-render
        const cb = document.querySelector(`input[onchange*="'${code}'"]`);
        if (cb) {
            const label = cb.closest('.test-checkbox');
            if (label) label.classList.toggle('selected', checked);
        }
        updateCreateButton();
    };

    function updateTotal() {
        const total = Array.from(selectedTests).reduce((sum, code) => {
            const t = allTests.find(x => x.testCode === code);
            return sum + (t ? t.price : 0);
        }, 0);
        const el = $('totalAmount');
        el.textContent = ui.fmtMoney(total);
        animate.bump(el);
    }

    function updateCreateButton() {
        const btn = $('createVisitBtn');
        btn.disabled = !selectedPatient || selectedTests.size === 0;
    }

    // ------------------------------------------------------------
    // CREATE VISIT
    // ------------------------------------------------------------
    window.createVisit = async function () {
        if (!selectedPatient) { ui.toast('Please select a patient', 'error'); return; }
        if (selectedTests.size === 0) { ui.toast('Please select at least one test', 'error'); return; }

        const btn = $('createVisitBtn');
        ui.setLoading(btn, true);

        try {
            const visit = await api.visits.create({
                patientId: selectedPatient.patientId,
                testCodes: Array.from(selectedTests),
            });
            ui.toast(`Visit ${visit.visitNumber} created`, 'success');
            setTimeout(() => {
                window.location.href = './visit.html?id=' + encodeURIComponent(visit.id);
            }, 400);
        } catch (err) {
            ui.toast(err.message || 'Failed to create visit', 'error');
            ui.setLoading(btn, false);
        }
    };

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    function init() {
        ui.startClock('clock');
        updateCreateButton();
        loadPatients();
        loadTests();

        let searchTimer;
        $('patientSearch').addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            const v = e.target.value.trim();
            searchTimer = setTimeout(() => renderPatientResults(v), 100);
        });

        // Close search dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#patientPick')) {
                $('patientResults').classList.add('hidden');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();