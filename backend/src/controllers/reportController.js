// src/controllers/reportController.js
// ------------------------------------------------------------------
// Report aggregation: daily / weekly / monthly summaries.
//
// Endpoints:
//   GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET /api/reports/summary/print?from=...&to=...
// ------------------------------------------------------------------
const prisma = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { buildReportSummaryHTML } = require('../services/reportService');

// ---------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------
function toDateOnly(d) {
    // Bucket by LOCAL calendar day, never UTC.
    // The frontend picks its from/to ranges in browser-local time and the
    // dashboard's "today" is local too, so the API must agree with both.
    // toISOString() (UTC) pushed visits made between local midnight and UTC
    // midnight — 00:00-05:00 in UTC+5 — into the PREVIOUS day's bucket.
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function startOfDay(dateStr) {
    // No trailing Z → parsed as LOCAL midnight, matching toDateOnly above.
    return new Date(dateStr + 'T00:00:00.000');
}

function endOfDay(dateStr) {
    // LOCAL end of day, so a visit at 23:59:59 local is still included.
    return new Date(dateStr + 'T23:59:59.999');
}

function isValidDate(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function parseRange(query) {
    const today = toDateOnly(new Date());

    let from = query.from || today;
    let to = query.to || from;

    if (!isValidDate(from)) throw new Error('Invalid "from" date. Use YYYY-MM-DD.');
    if (!isValidDate(to)) throw new Error('Invalid "to" date. Use YYYY-MM-DD.');
    if (from > to) [from, to] = [to, from];

    // Cap the range to prevent abuse (1 year max)
    const days = Math.round((new Date(to) - new Date(from)) / 86400000);
    if (days > 366) throw new Error('Date range cannot exceed one year.');

    return { from, to };
}

// ---------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------
async function buildSummary(from, to) {
    const visits = await prisma.labVisit.findMany({
        where: {
            visitDate: {
                gte: startOfDay(from),
                lte: endOfDay(to),
            },
        },
        include: {
            patient: true,
            records: {
                include: { test: true },
            },
        },
        orderBy: { visitDate: 'asc' },
    });

    // ---------- Income ----------
    let totalIncome = 0;
    let paidIncome = 0;
    let unpaidIncome = 0;
    let pendingVisits = 0;
    let completedVisits = 0;

    // ---------- By test ----------
    const byTest = {};       // code -> { testName, category, count, total }
    const byCategory = {};   // category -> { count, total }

    // ---------- By day ----------
    const byDay = {};        // YYYY-MM-DD -> { visits, income }

    // ---------- Patients ----------
    const patientVisits = {}; // patientId -> { name, visits, total }

    for (const v of visits) {
        totalIncome += v.totalAmount || 0;
        if (v.paymentStatus === 'Paid') paidIncome += v.totalAmount || 0;
        else unpaidIncome += v.totalAmount || 0;

        // A visit only counts as completed when it HAS records and every one of
        // them is done: [].every() is vacuously true, so a record-less visit
        // would otherwise be reported "Completed" (the frontend guards the same
        // way in visits.js / dashboard.js).
        const allDone = v.records.length > 0 &&
            v.records.every(r => r.resultStatus === 'Completed');
        if (allDone) completedVisits++;
        else pendingVisits++;

        // Per-day
        const dayKey = toDateOnly(v.visitDate);
        if (!byDay[dayKey]) byDay[dayKey] = { visits: 0, income: 0 };
        byDay[dayKey].visits++;
        if (v.paymentStatus === 'Paid') byDay[dayKey].income += v.totalAmount || 0;

        // Per-test and per-category
        for (const r of v.records) {
            const code = r.test.testCode;
            const cat = r.test.category || 'Other';

            if (!byTest[code]) {
                byTest[code] = {
                    code,
                    name: r.test.testName,
                    category: cat,
                    count: 0,
                    total: 0,
                };
            }
            byTest[code].count++;
            byTest[code].total += r.priceAtVisit || 0;

            if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, total: 0 };
            byCategory[cat].count++;
            byCategory[cat].total += r.priceAtVisit || 0;
        }

        // Per-patient
        const pid = v.patient.patientId;
        if (!patientVisits[pid]) {
            patientVisits[pid] = {
                patientId: pid,
                name: v.patient.name,
                visits: 0,
                total: 0,
            };
        }
        patientVisits[pid].visits++;
        if (v.paymentStatus === 'Paid') {
            patientVisits[pid].total += v.totalAmount || 0;
        }
    }

    // ---------- Sort results ----------
    const testList = Object.values(byTest).sort((a, b) => b.count - a.count);
    const categoryList = Object.values(byCategory).sort((a, b) => b.count - a.count);

    const dayList = Object.keys(byDay)
        .sort()
        .map(date => ({
            date,
            visits: byDay[date].visits,
            income: byDay[date].income,
        }));

    const topPatients = Object.values(patientVisits)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    // ---------- New vs returning ----------
    // A patient is "new" if their first ever visit is within this range.
    const uniquePatientIds = Object.keys(patientVisits);
    let newPatients = 0;
    let returningPatients = 0;

    if (uniquePatientIds.length > 0) {
        // Fetch the earliest visit for each patient in range (all-time)
        const earliestVisits = await prisma.labVisit.groupBy({
            by: ['patientId'],
            where: {
                patient: { patientId: { in: uniquePatientIds } },
            },
            _min: { visitDate: true },
        });

        const earliestMap = {};
        for (const row of earliestVisits) {
            earliestMap[row.patientId] = row._min.visitDate;
        }

        // Map cuid back to human patientId for comparison
        const patients = await prisma.patient.findMany({
            where: { patientId: { in: uniquePatientIds } },
            select: { id: true, patientId: true },
        });
        const cuidToHuman = {};
        for (const p of patients) cuidToHuman[p.id] = p.patientId;

        for (const [cuid, earliest] of Object.entries(earliestMap)) {
            const humanId = cuidToHuman[cuid];
            if (!humanId) continue;
            const earliestStr = toDateOnly(earliest);
            if (earliestStr >= from && earliestStr <= to) newPatients++;
            else returningPatients++;
        }
    }

    return {
        range: { from, to },
        income: {
            total: totalIncome,
            paid: paidIncome,
            unpaid: unpaidIncome,
        },
        visits: {
            total: visits.length,
            completed: completedVisits,
            pending: pendingVisits,
        },
        patients: {
            unique: uniquePatientIds.length,
            new: newPatients,
            returning: returningPatients,
        },
        byTest: testList,
        byCategory: categoryList,
        byDay: dayList,
        topPatients,
    };
}

// ---------------------------------------------------------------
// Endpoint: GET /api/reports/summary
// ---------------------------------------------------------------
exports.getSummary = async (req, res, next) => {
    try {
        const { from, to } = parseRange(req.query);
        const summary = await buildSummary(from, to);
        success(res, summary);
    } catch (err) {
        if (err.message && err.message.toLowerCase().includes('date')) {
            return error(res, err.message, 400);
        }
        next(err);
    }
};

// ---------------------------------------------------------------
// Endpoint: GET /api/reports/summary/print
// ---------------------------------------------------------------
exports.getSummaryPrint = async (req, res, next) => {
    try {
        const { from, to } = parseRange(req.query);
        const summary = await buildSummary(from, to);
        const html = buildReportSummaryHTML(summary);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        if (err.message && err.message.toLowerCase().includes('date')) {
            return error(res, err.message, 400);
        }
        next(err);
    }
};