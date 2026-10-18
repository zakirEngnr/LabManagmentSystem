// ============================================================
// assets/js/pages/catalog.js
// Test catalog viewer with search + category filter.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    let allTests = [];

    function render() {
        const tbody = $('catalogBody');
        const term = $('searchInput').value.trim().toLowerCase();
        const category = $('categoryFilter').value;

        const filtered = allTests.filter(t => {
            if (category && t.category !== category) return false;
            if (!term) return true;
            const hay = [t.testCode, t.testName, t.shortName, t.category].join(' ').toLowerCase();
            return hay.includes(term);
        });

        $('catalogCount').textContent = filtered.length === allTests.length
            ? `${allTests.length} test${allTests.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${allTests.length} shown`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5">
                        <div class="empty-state">
                            <span class="icon"></span>
                            <div class="title">No tests match</div>
                            Try clearing the search or filter.
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(t => `
            <tr>
                <td><strong>${ui.escapeHtml(t.testCode)}</strong></td>
                <td>${ui.escapeHtml(t.testName)}</td>
                <td>${ui.escapeHtml(t.category)}</td>
                <td class="text-right">${t.fields.length}</td>
                <td class="text-right">${ui.fmtMoney(t.price)}</td>
            </tr>
        `).join('');
    }

    function populateCategories() {
        const cats = Array.from(new Set(allTests.map(t => t.category))).sort();
        const sel = $('categoryFilter');
        sel.innerHTML = '<option value="">All Categories</option>' +
            cats.map(c => `<option value="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</option>`).join('');
    }

    async function load() {
        animate.skeletonRows($('catalogBody'), 6, 5);
        try {
            allTests = await api.tests.list();
            populateCategories();
            render();
        } catch (err) {
            if (err.status === 401) return;
            $('catalogCount').textContent = 'Failed to load';
            $('catalogBody').innerHTML = `
                <tr>
                    <td colspan="5">
                        <div class="empty-state">
                            <span class="icon"></span>
                            <div class="title">Could not load catalog</div>
                            ${ui.escapeHtml(err.message || '')}
                        </div>
                    </td>
                </tr>`;
        }
    }

    function init() {
        ui.startClock('clock');

        let timer;
        $('searchInput').addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(render, 120);
        });
        $('categoryFilter').addEventListener('change', render);

        load();
    }

    document.addEventListener('DOMContentLoaded', init);
})();