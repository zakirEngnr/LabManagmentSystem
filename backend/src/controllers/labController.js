// src/controllers/labController.js
const prisma = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { createVisitWithNumber } = require('../services/idGeneratorService');


// GET /api/tests
exports.listTests = async (req, res, next) => {
    try {
        const tests = await prisma.labTest.findMany({
            where: { isActive: true },
            include: {
                fields: { orderBy: { sortOrder: 'asc' } },
            },
            orderBy: { testCode: 'asc' },
        });
        success(res, tests);
    } catch (err) {
        next(err);
    }
};

// ============================================================
// VISITS
// ============================================================

// GET /api/visits
exports.listVisits = async (req, res, next) => {
    try {
        const visits = await prisma.labVisit.findMany({
            include: {
                patient: true,
                records: { include: { test: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        success(res, visits);
    } catch (err) {
        next(err);
    }
};

// GET /api/visits/:id
// Full visit detail with all records, fields, and values
exports.getVisit = async (req, res, next) => {
    try {
        const visit = await prisma.labVisit.findUnique({
            where: { id: req.params.id },
            include: {
                patient: true,
                records: {
                    include: {
                        test: {
                            include: {
                                fields: { orderBy: { sortOrder: 'asc' } },
                            },
                        },
                        values: true,
                    },
                },
            },
        });
        if (!visit) return error(res, 'Visit not found', 404);
        success(res, visit);
    } catch (err) {
        next(err);
    }
};

// ------------------------------------------------------------
// POST /api/visits
// Body: { patientId, testCodes: ["T001", "T006"] }
// Creates a visit with one LabRecord per selected test.
// ------------------------------------------------------------
exports.createVisit = async (req, res, next) => {
    try {
        const { patientId, testCodes } = req.body;

        // Validation. The API is the trust boundary: malformed types must be a
        // clean 400 — passing a non-string patientId straight to Prisma throws a
        // validation error that surfaces as an opaque masked 500.
        if (patientId === undefined || patientId === null || patientId === '') {
            return error(res, 'patientId is required', 400);
        }
        if (typeof patientId !== 'string') {
            return error(res, 'patientId must be a string', 400);
        }
        if (!Array.isArray(testCodes) || testCodes.length === 0) {
            return error(res, 'testCodes must be a non-empty array', 400);
        }
        if (!testCodes.every((c) => typeof c === 'string' && c.trim() !== '')) {
            return error(res, 'testCodes must contain only test code strings', 400);
        }

        // De-duplicate: ["T001","T001"] must create ONE T001 record, not a
        // confusing `Unknown or inactive test codes: ` (with an empty list)
        // rejection from the length comparison below.
        const uniqueCodes = [...new Set(testCodes.map((c) => c.trim()))];
        if (uniqueCodes.length > 100) {
            return error(res, 'Too many tests in one visit (max 100)', 400);
        }

        // Find the patient
        const patient = await prisma.patient.findUnique({
            where: { patientId },
        });
        if (!patient) return error(res, `Patient ${patientId} not found`, 404);

        // Find all selected tests
        const tests = await prisma.labTest.findMany({
            where: { testCode: { in: uniqueCodes }, isActive: true },
        });

        if (tests.length === 0) {
            return error(res, 'No valid tests found for the given codes', 400);
        }
        if (tests.length !== uniqueCodes.length) {
            const found = tests.map((t) => t.testCode);
            const missing = uniqueCodes.filter((c) => !found.includes(c));
            return error(res, `Unknown or inactive test codes: ${missing.join(', ')}`, 400);
        }

        // Calculate total
        const totalAmount = tests.reduce((sum, t) => sum + t.price, 0);

        // Create visit + records atomically (with counter-based LV-XXXX)
        const visit = await createVisitWithNumber({
            patientId: patient.id,
            totalAmount,
            records: {
                create: tests.map((t) => ({
                    patientId: patient.id,
                    testId: t.id,
                    priceAtVisit: t.price,
                })),
            },
        });

        // Refetch with relations for a clean response
        const full = await prisma.labVisit.findUnique({
            where: { id: visit.id },
            include: {
                patient: true,
                records: { include: { test: true } },
            },
        });

        success(res, full, 201);
    } catch (err) {
        next(err);
    }
};

// ------------------------------------------------------------
// PUT /api/visits/:id/payment
// Body: { paymentStatus: "Paid" | "Unpaid" }
// ------------------------------------------------------------
exports.markPayment = async (req, res, next) => {
    try {
        const { paymentStatus } = req.body;

        if (!['Paid', 'Unpaid'].includes(paymentStatus)) {
            return error(res, 'paymentStatus must be "Paid" or "Unpaid"', 400);
        }

        // Check visit exists
        const visit = await prisma.labVisit.findUnique({
            where: { id: req.params.id },
        });
        if (!visit) return error(res, 'Visit not found', 404);

        const updated = await prisma.labVisit.update({
            where: { id: req.params.id },
            data: { paymentStatus },
        });

        success(res, updated);
    } catch (err) {
        next(err);
    }
};

// ============================================================
// RECORDS (results entry)
// ============================================================

// GET /api/visits/records/:recordId
// One record with its test fields and existing values
exports.getRecord = async (req, res, next) => {
    try {
        const record = await prisma.labRecord.findUnique({
            where: { id: req.params.recordId },
            include: {
                test: {
                    include: {
                        fields: { orderBy: { sortOrder: 'asc' } },
                    },
                },
                values: true,
                visit: { include: { patient: true } },
            },
        });
        if (!record) return error(res, 'Record not found', 404);
        success(res, record);
    } catch (err) {
        next(err);
    }
};

// ------------------------------------------------------------
// PUT /api/visits/records/:recordId/results
// Body: { values: [{ fieldId, value }, ...] }
// Replaces existing values, marks record complete, and
// auto-completes the visit if all its records are done.
// ------------------------------------------------------------
exports.saveResults = async (req, res, next) => {
    try {
        const { recordId } = req.params;
        const { values } = req.body;

        if (!Array.isArray(values)) {
            return error(res, 'values must be an array', 400);
        }

        // Shape checks BEFORE touching the database. `values.map(v => v.fieldId)`
        // on a null/garbage entry throws a TypeError that surfaces as an opaque
        // masked 500 instead of a precise 400, and uncapped values would let the
        // 100kb body limit park 100kb strings in the DB and the printed report.
        const MAX_VALUES = 200;      // the widest test (CBC) has 20 fields
        const MAX_VALUE_LEN = 255;   // result strings are short by nature

        if (values.length > MAX_VALUES) {
            return error(res, `Too many values (max ${MAX_VALUES})`, 400);
        }
        for (const v of values) {
            if (!v || typeof v !== 'object' || Array.isArray(v)) {
                return error(res, 'Each value must be an object { fieldId, value }', 400);
            }
            if (typeof v.fieldId !== 'string' || v.fieldId.trim() === '') {
                return error(res, 'Each value must have a non-empty string fieldId', 400);
            }
            if (v.value !== undefined && v.value !== null &&
                typeof v.value !== 'string' && typeof v.value !== 'number') {
                return error(res, 'Each value must be a string or number', 400);
            }
            if (v.value != null && String(v.value).length > MAX_VALUE_LEN) {
                return error(res, `Each value must be at most ${MAX_VALUE_LEN} characters`, 400);
            }
        }

        // Reject duplicate fieldIds up front. Without this, two rows for the
        // same field would be written and `validFields.length` would no longer
        // match `fieldIds.length`, producing a confusing 400 instead of a
        // precise one.
        const fieldIds = values.map((v) => v.fieldId);
        if (new Set(fieldIds).size !== fieldIds.length) {
            return error(res, 'Duplicate fieldId in values', 400);
        }

        // Confirm record exists
        const record = await prisma.labRecord.findUnique({
            where: { id: recordId },
        });
        if (!record) return error(res, 'Record not found', 404);

        // Confirm every fieldId belongs to this record's test
        const validFields = await prisma.labTestField.findMany({
            where: { id: { in: fieldIds }, testId: record.testId },
            select: { id: true },
        });
        if (validFields.length !== fieldIds.length) {
            return error(res, 'One or more fieldIds do not belong to this test', 400);
        }

        // Atomic: replace values + mark record complete + complete the visit.
        //
        // The "are all siblings done?" check MUST live inside the transaction.
        // When it ran outside, two technicians saving different records of the
        // same visit at the same moment could each read the other's record as
        // still Pending, both skip the visit update, and leave the visit stuck
        // in "InProgress" forever even though every result was entered.
        const visitCompleted = await prisma.$transaction(async (tx) => {
            // delete + create inside one transaction: readers see either the
            // old set or the new set, never a half-written one.
            await tx.labValue.deleteMany({ where: { labRecordId: recordId } });

            await tx.labValue.createMany({
                data: values.map((v) => ({
                    labRecordId: recordId,
                    fieldId: v.fieldId,
                    value: v.value != null ? String(v.value) : '',
                })),
            });

            await tx.labRecord.update({
                where: { id: recordId },
                data: { resultStatus: 'Completed', completedAt: new Date() },
            });

            // Read the siblings from THIS transaction so we see every sibling
            // write that has already committed.
            const siblings = await tx.labRecord.findMany({
                where: { visitId: record.visitId },
                select: { resultStatus: true },
            });
            const allDone = siblings.every((r) => r.resultStatus === 'Completed');

            if (allDone) {
                // Guarded update: only flips the status if it is not already
                // Completed, so concurrent completions are harmless.
                await tx.labVisit.updateMany({
                    where: { id: record.visitId, status: { not: 'Completed' } },
                    data: { status: 'Completed' },
                });
            }

            return allDone;
        });

        success(res, { saved: true, visitCompleted });
    } catch (err) {
        next(err);
    }
};


const { buildReportHTML } = require('../services/reportService');


exports.getReport = async (req, res, next) => {
    try {
        const visit = await prisma.labVisit.findUnique({
            where: { id: req.params.id },
            include: {
                patient: true,
                records: {
                    include: {
                        test: { include: { fields: { orderBy: { sortOrder: 'asc' } } } },
                        values: true,
                    },
                },
            },
        });
        if (!visit) return error(res, 'Visit not found', 404);

        const html = buildReportHTML(visit);

        // Return as HTML (not JSON) so browsers render it directly.
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        next(err);
    }
};