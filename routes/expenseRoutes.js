const express = require('express');
const router = express.Router();
const {
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  updateExpenseStatus,
  getExpenseAnalytics,
} = require('../controllers/expenseController');
const { requireUser, forbidLoanOfficer } = require('../middleware/roleGuard');

// Note: Authentication is handled via global userIdentity middleware in server.js
// Additional per-route guard: require authenticated user and forbid loan officers
router.use(requireUser, forbidLoanOfficer);

// Create new expense
router.post('/', createExpense);

// Get all expenses with filtering
router.get('/', getAllExpenses);

// Analytics
router.get('/analytics', getExpenseAnalytics);

// Single expense
router.get('/:id', getExpenseById);
router.put('/:id', updateExpense);
router.patch('/:id/status', updateExpenseStatus);
router.delete('/:id', deleteExpense);

module.exports = router;
