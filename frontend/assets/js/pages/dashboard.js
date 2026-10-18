// ============================================================
// assets/js/pages/dashboard.js
// Loads visits, computes today's stats, renders recent visits.
// ============================================================

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    // ------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------
    function isToday(iso) {
        if (!iso) return false;
        const d = new Date(iso);
        const t = new Date();
        return d.getFullYear() === t.getFullYear()
            && d.getMonth() === t.getMonth()
            && d.getDate() === t.getDate();
    }

    // A visit is only truly complete when it HAS records AND all are Completed.
    // Array.every() is vacuously true on [], so a visit with zero records would
    // otherwise be counted/labelled "Completed".
    function isVisitComplete(v) {
        return v.records.length > 0 &&
            v.records.every(r => r.resultStatus === 'Completed');
    }

    function renderTodayLabel() {
        const d = new Date();
        $('todayDate').textContent = d.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    }

    // ------------------------------------------------------------
    // STATS
    // ------------------------------------------------------------
    function renderStats(visits) {
        const today = visits.filter(v => isToday(v.visitDate));

        // Pending results = sum of unfinished records
        const pending = visits.reduce((n, v) => {
            return n + v.records.filter(r => r.resultStatus === 'Pending').length;
        }, 0);

        const completedToday = today.filter(isVisitComplete).length;

        const incomeToday = today
            .filter(v => v.paymentStatus === 'Paid')
            .reduce((sum, v) => sum + (v.totalAmount || 0), 0);

        // Animated count-up (falls back to instant if reduced motion)
        animate.countUp($('statVisits'), today.length);
        animate.countUp($('statPending'), pending);
        animate.countUp($('statCompleted'), completedToday);
        animate.countUp($('statIncome'), incomeToday, { prefix: 'Rs. ' });
    }

    // ------------------------------------------------------------
    // RECENT VISITS TABLE
    // ------------------------------------------------------------
    function renderRecent(visits) {
        const tbody = $('recentVisitsBody');
        const recent = visits.slice(0, 10);

        if (recent.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <span class="icon">📋</span>
                            <div class="title">No visits yet</div>
                            Click <strong>New Visit</strong> to register your first patient.
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = recent.map(v => {
            const testNames = v.records
                .map(r => r.test.shortName || r.test.testName)
                .join(', ');

            const allDone = isVisitComplete(v);
            const statusBadge = ui.resultBadge(allDone ? 'Completed' : 'Pending');

            return `
                <tr class="clickable" data-visit-id="${ui.escapeHtml(v.id)}">
                    <td><strong>${ui.escapeHtml(v.visitNumber)}</strong></td>
                    <td>
                        <div>${ui.escapeHtml(v.patient.name)}</div>
                        <div class="sub">${ui.escapeHtml(v.patient.patientId)}</div>
                    </td>
                    <td>${ui.fmtTime(v.visitDate)}</td>
                    <td>${ui.escapeHtml(testNames)}</td>
                    <td class="text-right">${ui.fmtMoney(v.totalAmount)}</td>
                    <td>${ui.paymentBadge(v.paymentStatus)}</td>
                    <td>${statusBadge}</td>
                </tr>`;
        }).join('');

        // Row click → visit detail
        tbody.querySelectorAll('tr[data-visit-id]').forEach(tr => {
            tr.addEventListener('click', () => {
                const id = tr.getAttribute('data-visit-id');
                window.location.href = './pages/visit.html?id=' + encodeURIComponent(id);
            });
        });
    }

    // ------------------------------------------------------------
    // LOADING STATE
    // ------------------------------------------------------------
    function showSkeleton() {
        animate.skeletonRows($('recentVisitsBody'), 4, 7);
    }

    function showLoadError(message) {
        $('recentVisitsBody').innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <span class="icon">⚠️</span>
                        <div class="title">Could not load visits</div>
                        ${ui.escapeHtml(message || '')}
                    </div>
                </td>
            </tr>`;
    }

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    async function init() {
        renderTodayLabel();
        ui.startClock('clock');
        showSkeleton();

        try {
            const visits = await api.visits.list();
            renderStats(visits);
            renderRecent(visits);
        } catch (err) {
            // 401 is handled by api.js (redirects). Anything else:
            if (err && err.status !== 401) {
                showLoadError(err.message);
                ui.toast(err.message || 'Failed to load dashboard', 'error');
            }
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();