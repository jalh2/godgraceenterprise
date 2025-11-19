const express = require('express');
const router = express.Router();
const { createMetrics, getSummary, getProfit, recalculateMetrics } = require('../controllers/metricsController');

// Create metrics (single or batch via { entries: [] })
router.post('/', createMetrics);

// Recalculate all metrics from scratch (Admin only)
router.post('/recalculate', recalculateMetrics);

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
