// src/routes/reportRoutes.js
const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const controller = require('../controllers/reportController');

const router = express.Router();

// Both routes require the bearer token in the Authorization header.
// NOTE: never accept a `?token=` query parameter here — query strings end up
// in server logs, browser history and Referer headers.
router.get('/summary', requireAuth, controller.getSummary);
router.get('/summary/print', requireAuth, controller.getSummaryPrint);

module.exports = router;