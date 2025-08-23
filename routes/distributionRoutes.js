const express = require('express');
const router = express.Router();
const {
  createDistribution,
  getDistributionsByLoan,
  getAllDistributions,
} = require('../controllers/distributionController');

// Top-level
router.get('/', getAllDistributions);
router.post('/', createDistribution);

// Loan-scoped endpoints
router.get('/loan/:loanId', getDistributionsByLoan);
router.post('/loan/:id', createDistribution);

module.exports = router;
