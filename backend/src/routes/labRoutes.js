const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const { reportCsp } = require('../middleware/securityHeaders');
const controller = require('../controllers/labController');

const router = express.Router();

// Every lab route requires a valid bearer token.

router.get('/tests', requireAuth, controller.listTests);

router.get('/visits', requireAuth, controller.listVisits);
router.post('/visits', requireAuth, controller.createVisit);
router.get('/visits/:id', requireAuth, controller.getVisit);
router.put('/visits/:id/payment', requireAuth, controller.markPayment);

// These use a distinct literal prefix so they never collide with '/visits/:id'.
router.get('/visits/records/:recordId', requireAuth, controller.getRecord);
router.put('/visits/records/:recordId/results', requireAuth, controller.saveResults);
// Report — a full HTML document, so it overrides the API's strict
// `default-src 'none'` CSP with a policy that allows the report's own
// inline style/print script. Auth is still required.
router.get('/visits/:id/report', requireAuth, reportCsp, controller.getReport);

module.exports = router;

