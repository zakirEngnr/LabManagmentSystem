// ============================================================
// assets/js/pages/reports.js
// Period reports: Daily / Weekly / Monthly / Custom range.
//
// Pulls a JSON summary from api.reports.summary(from, to) and renders
// stat cards + by-day / by-category / by-test / top-patients tables.
// "Print / Save PDF" reuses the server-rendered HTML report via
// api.reports.openPrint(from, to).
//
// All dynamic values are HTML-escaped (user names, test names, etc.).
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    // YYYY-MM-DD for a Date, in LOCAL time (so "today" matches the user).
    function toISO(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    // Inclusive weekday range: week starts on Monday.
    function weekRange(anchor) {
        const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
        const offset = (d.getDay() + 6) % 7; // 0 = Monday
        const start = new Date(d);
        start.setDate(d.getDate() - offset);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { from: toISO(start), to: toISO(end) };
    }

    function monthRange(anchor) {
        const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
        return { from: toISO(start), to: toISO(end) };
    }

    function computeRange(period) {
        const today = new Date();
        if (period === 'weekly') return weekRange(today);
        if (period === 'monthly') return monthRange(today);
        const d = toISO(today); // 'daily' + fallthrough
        return { from: d, to: d };
    }

    function rangeLabel(from, to) {
        if (from === to) return ui.fmtDate(from + 'T00:00:00');
        return `${ui.fmtDate(from + 'T00:00:00')} — ${ui.fmtDate(to + 'T00:00:00')}`;
    }

    let period = 'daily';
    let range = computeRange('daily');

    // ------------------------------------------------------------
    // RENDER HELPERS
    // ------------------------------------------------------------
    function emptyRow(colspan, message) {
        return `<tr><td colspan="${colspan}"><div class="empty-state">${ui.escapeHtml(message)}</div></td></tr>`;
    }

    function renderStats(s) {
        animate.countUp($('statIncome'), s.income.total, { prefix: 'Rs. ' });
        animate.countUp($('statVisits'), s.visits.total);
        animate.countUp($('statPending'), s.visits.pending);
        animate.countUp($('statPatients'), s.patients.unique);
        $('statVisitsHint').textContent =
            `${s.visits.completed} completed · ${s.visits.pending} pending`;
        $('statPatientsHint').textContent =
            `${s.patients.new} new · ${s.patients.returning} returning`;
    }

    function renderByDay(s) {
        const card = $('byDayCard');
        const body = $('byDayBody');
        // A single-day range has nothing to break down — hide the table.
        if (s.range.from === s.range.to || !s.byDay.length) {
            card.classList.add('hidden');
            return;
        }
        card.classList.remove('hidden');
        $('byDayCount').textContent = `${s.byDay.length} days`;
        body.innerHTML = s.byDay.map(d => `
            <tr>
                <td>${ui.escapeHtml(ui.fmtDate(d.date + 'T00:00:00'))}</td>
                <td class="text-right">${d.visits}</td>
                <td class="text-right">${ui.fmtMoney(d.income)}</td>
            </tr>`).join('');
    }

    function renderByCategory(s) {
        const body = $('byCategoryBody');
        if (!s.byCategory.length) return body.innerHTML = emptyRow(3, 'No paid visits in this period');
        body.innerHTML = s.byCategory.map(c => `
            <tr>
                <td><strong>${ui.escapeHtml(c.category)}</strong></td>
                <td class="text-right">${c.count}</td>
                <td class="text-right">${ui.fmtMoney(c.total)}</td>
            </tr>`).join('');
    }

    function renderByTest(s) {
        const body = $('byTestBody');
        if (!s.byTest.length) return body.innerHTML = emptyRow(4, 'No paid visits in this period');
        body.innerHTML = s.byTest.map(t => `
            <tr>
                <td><strong>${ui.escapeHtml(t.name)}</strong></td>
                <td>${ui.escapeHtml(t.category)}</td>
                <td class="text-right">${t.count}</td>
                <td class="text-right">${ui.fmtMoney(t.total)}</td>
            </tr>`).join('');
    }

    function renderTopPatients(s) {
        const body = $('topPatientsBody');
        if (!s.topPatients.length) return body.innerHTML = emptyRow(4, 'No paid visits in this period');
        body.innerHTML = s.topPatients.map(p => `
            <tr>
                <td><strong>${ui.escapeHtml(p.name)}</strong></td>
                <td>${ui.escapeHtml(p.patientId)}</td>
                <td class="text-right">${p.visits}</td>
                <td class="text-right">${ui.fmtMoney(p.total)}</td>
            </tr>`).join('');
    }

    function renderAll(s) {
        $('rangeLabel').textContent = rangeLabel(s.range.from, s.range.to);
        renderStats(s);
        renderByDay(s);
        renderByCategory(s);
        renderByTest(s);
        renderTopPatients(s);
    }

    // ------------------------------------------------------------
    // LOAD
    // ------------------------------------------------------------
    async function load() {
        animate.skeletonRows($('byDayBody'), 4, 3);
        animate.skeletonRows($('byCategoryBody'), 4, 3);
        animate.skeletonRows($('byTestBody'), 4, 4);
        animate.skeletonRows($('topPatientsBody'), 4, 4);
        try {
            const s = await api.reports.summary(range.from, range.to);
            renderAll(s);
        } catch (err) {
            if (err && err.status === 401) return; // api.js already redirected
            ui.toast(err.message || 'Failed to load report', 'error');
            $('rangeLabel').textContent = 'Failed to load report';
        }
    }

    // ------------------------------------------------------------
    // PERIOD SWITCHING (called by inline onclick in reports.html)
    // ------------------------------------------------------------
    window.setPeriod = function (next) {
        period = next;
        document.querySelectorAll('.period-tab').forEach(b =>
            b.classList.toggle('active', b.dataset.period === next));
        $('customRange').classList.toggle('hidden', next !== 'custom');
        if (next !== 'custom') {
            range = computeRange(next);
            $('fromDate').value = range.from;
            $('toDate').value = range.to;
            load();
        }
    };

    window.applyCustomRange = function () {
        const from = $('fromDate').value;
        const to = $('toDate').value;
        if (!from || !to) { ui.toast('Pick both a start and end date', 'error'); return; }
        if (from > to) { ui.toast('Start date must be before end date', 'error'); return; }
        period = 'custom';
        range = { from, to };
        load();
    };

    window.printReport = async function () {
        const btn = $('printBtn');
        ui.setLoading(btn, true);
        try {
            await api.reports.openPrint(range.from, range.to);
        } catch (err) {
            ui.toast(err.message || 'Failed to open printable report', 'error');
        } finally {
            ui.setLoading(btn, false);
        }
    };

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    function init() {
        ui.startClock('clock');
        $('fromDate').value = range.from;
        $('toDate').value = range.to;
        load();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
