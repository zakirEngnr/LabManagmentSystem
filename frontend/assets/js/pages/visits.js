// ============================================================
// assets/js/pages/visits.js
// Visit list with search + filters.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    let allVisits = [];

    // ------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------
    // A visit counts as Completed only when it HAS records and every one of
    // them is done. The length check is essential: `[].every()` returns true,
    // so without it a visit with no records would be reported "Completed".
    function visitStatus(v) {
        const records = v.records || [];
        const allDone = records.length > 0 &&
            records.every(r => r.resultStatus === 'Completed');
        return allDone ? 'Completed' : 'Pending';
    }

    // Comma-separated test names, or an em dash when the visit has none.
    function testNamesOf(v) {
        const names = (v.records || [])
            .map(r => (r.test && (r.test.shortName || r.test.testName)) || '')
            .filter(Boolean)
            .join(', ');
        return names || '—';
    }

    // Single navigation path, shared by mouse and keyboard.
    function openVisit(id) {
        window.location.href = './visit.html?id=' + encodeURIComponent(id);
    }

    // ------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------
    function renderVisits() {
        const tbody = $('visitsTableBody');
        const term = $('searchInput').value.trim().toLowerCase();
        const paymentFilter = $('paymentFilter').value;
        const statusFilter = $('statusFilter').value;

        const filtered = allVisits.filter(v => {
            const patient = v.patient || {};

            // Search filter — null-safe: one missing relation must not blank
            // the whole table.
            if (term) {
                const haystack = [
                    v.visitNumber,
                    patient.name,
                    patient.patientId,
                ].filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(term)) return false;
            }

            // Payment filter
            if (paymentFilter && v.paymentStatus !== paymentFilter) return false;

            // Status filter
            if (statusFilter && visitStatus(v) !== statusFilter) return false;

            return true;
        });

        $('visitCount').textContent = filtered.length === allVisits.length
            ? `${allVisits.length} visit${allVisits.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${allVisits.length} shown`;

        if (filtered.length === 0) {
            const isEmpty = allVisits.length === 0;
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <span class="icon">${isEmpty ? '' : ''}</span>
                            <div class="title">${isEmpty ? 'No visits yet' : 'No visits match your filters'}</div>
                            ${isEmpty
                                ? 'Click <strong>New Visit</strong> to register your first patient.'
                                : 'Try clearing the search or filters.'}
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(v => {
            const patient = v.patient || {};
            const id = v.id || '';

            // The Visit # is a real <a>: native focus, Enter-to-open, and screen
            // readers announce it as a link. role="link" on the <tr> would have
            // stripped the row semantics from the accessibility tree instead.
            const visitCell = id
                ? `<a class="visit-link" href="./visit.html?id=${encodeURIComponent(id)}">` +
                  `${ui.escapeHtml(v.visitNumber)}</a>`
                : `<strong>${ui.escapeHtml(v.visitNumber)}</strong>`;

            return `
                <tr class="clickable" data-visit-id="${ui.escapeHtml(id)}">
                    <td>${visitCell}</td>
                    <td>
                        <div>${ui.escapeHtml(patient.name || '—')}</div>
                        <div class="sub">${ui.escapeHtml(patient.patientId || '')}</div>
                    </td>
                    <td>${ui.fmtDateTime(v.visitDate)}</td>
                    <td>${ui.escapeHtml(testNamesOf(v))}</td>
                    <td class="text-right">${ui.fmtMoney(v.totalAmount)}</td>
                    <td>${ui.paymentBadge(v.paymentStatus)}</td>
                    <td>${ui.resultBadge(visitStatus(v))}</td>
                </tr>`;
        }).join('');

        // Clicking anywhere on the row opens the visit — a convenience layered
        // over the anchor, which already handles mouse and keyboard by itself.
        tbody.querySelectorAll('tr[data-visit-id]').forEach(tr => {
            const id = tr.getAttribute('data-visit-id');
            if (!id) return;              // nothing to navigate to
            tr.addEventListener('click', (e) => {
                // The anchor navigates on its own; don't fire twice.
                if (e.target.closest('a')) return;
                openVisit(id);
            });
        });
    }

    // ------------------------------------------------------------
    // SKELETON
    // ------------------------------------------------------------
    function showSkeleton() {
        animate.skeletonRows($('visitsTableBody'), 6, 7);
        $('visitCount').textContent = 'Loading…';
    }

    // ------------------------------------------------------------
    // LOAD
    // ------------------------------------------------------------
    async function load() {
        showSkeleton();
        try {
            allVisits = await api.visits.list();
            renderVisits();
        } catch (err) {
            if (err && err.status === 401) return; // handled by api.js
            $('visitCount').textContent = 'Failed to load';
            $('visitsTableBody').innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <span class="icon"></span>
                            <div class="title">Could not load visits</div>
                            ${ui.escapeHtml(err.message || '')}
                        </div>
                    </td>
                </tr>`;
            ui.toast(err.message || 'Failed to load visits', 'error');
        }
    }

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    function init() {
        ui.startClock('clock');

        // Debounced search
        let searchTimer;
        $('searchInput').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderVisits, 150);
        });

        $('paymentFilter').addEventListener('change', renderVisits);
        $('statusFilter').addEventListener('change', renderVisits);

        load();
    }

    // Initialise as soon as the DOM is usable. The script currently sits at the
    // end of <body> (so readyState is already 'interactive'), but checking
    // rather than assuming means moving this file into <head> cannot silently
    // dead-end the page — the listener would simply never fire.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();