const express = require('express');
const router = express.Router();
const { createMetrics, getSummary, getProfit } = require('../controllers/metricsController');

// Create metrics (single or batch via { entries: [] })
router.post('/', createMetrics);

// Get aggregated metrics summary
// Query params:
// - metrics: comma-separated metric names
// - groupBy: day|week|month|year (default: day)
// - dateFrom, dateTo: ISO dates
// - branchName, branchCode, loanOfficerName, currency
router.get('/summary', getSummary);

// Get profit breakdown (income - expenses)
router.get('/profit', getProfit);

module.exports = router;
