// src/routes/patientRoutes.js
const express = require('express');
const requireAuth = require('../middleware/authMiddleware');
const controller = require('../controllers/patientController');

const router = express.Router();

// Every patient route requires a valid bearer token.
router.get('/', requireAuth, controller.list);
router.post('/', requireAuth, controller.create);
router.get('/:id', requireAuth, controller.getById);

module.exports = router;

