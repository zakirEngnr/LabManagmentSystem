const prisma = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { createPatientWithId } = require('../services/idGeneratorService');

// GET /api/patients
// List all patients with a count of their visits
exports.list = async (req, res, next) => {
    try {
        const patients = await prisma.patient.findMany({
            include: {
                _count: { select: { visits: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        success(res, patients);
    } catch (err) {
        next(err);
    }
};

// POST /api/patients
// Body: { name, age, gender, contact?, address? }
//
// Validation is intentionally stricter than the frontend form: the API is the
// trust boundary, so it must defend itself even against a caller that skips the
// UI. We cap field lengths (the SQLite rows and printed reports assume sane
// sizes), coerce/range-check the age, and accept only known gender values.
const ALLOWED_GENDERS = ['Male', 'Female', 'Other'];
const MAX_NAME = 100;
const MAX_CONTACT = 40;
const MAX_ADDRESS = 300;

exports.create = async (req, res, next) => {
    try {
        const { name, age, gender, contact, address } = req.body;

        // Types first (the API is the trust boundary).
        if (typeof name !== 'string' || typeof gender !== 'string') {
            return error(res, 'Name, age, and gender are required', 400);
        }

        // Required-and-non-empty. Note: `age: 0` is a valid newborn, so presence
        // must be checked explicitly — a falsy `!age` would wrongly reject it.
        const trimmedName = name.trim();
        if (!trimmedName || gender === '' || age === undefined || age === null || age === '') {
            return error(res, 'Name, age, and gender are required', 400);
        }

        // Age: a real integer within a human range (matches the UI's 0–150).
        const ageNum = parseInt(age, 10);
        if (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 150) {
            return error(res, 'Age must be a number between 0 and 150', 400);
        }

        // Gender: an allow-list, not free text.
        if (!ALLOWED_GENDERS.includes(gender)) {
            return error(res, `Gender must be one of: ${ALLOWED_GENDERS.join(', ')}`, 400);
        }

        // Length caps (defense-in-depth; also keeps the report layout stable).
        if (trimmedName.length > MAX_NAME) {
            return error(res, `Name must be at most ${MAX_NAME} characters`, 400);
        }
        if (typeof contact === 'string' && contact.trim().length > MAX_CONTACT) {
            return error(res, `Contact must be at most ${MAX_CONTACT} characters`, 400);
        }
        if (typeof address === 'string' && address.trim().length > MAX_ADDRESS) {
            return error(res, `Address must be at most ${MAX_ADDRESS} characters`, 400);
        }

        // Create with auto-generated patientId (PT-XXXX)
        const patient = await createPatientWithId({
            name: trimmedName,
            age: ageNum,
            gender,
            contact: typeof contact === 'string' ? contact.trim() || null : null,
            address: typeof address === 'string' ? address.trim() || null : null,
        });

        success(res, patient, 201);
    } catch (err) {
        next(err);
    }
};

// GET /api/patients/:id
// Get one patient with their full visit history
exports.getById = async (req, res, next) => {
    try {
        const patient = await prisma.patient.findUnique({
            where: { id: req.params.id },
            include: {
                visits: {
                    orderBy: { createdAt: 'desc' },
                    include: {
                        records: { include: { test: true } },
                    },
                },
            },
        });

        if (!patient) return error(res, 'Patient not found', 404);
        success(res, patient);
    } catch (err) {
        next(err);
    }
};