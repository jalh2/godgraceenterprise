const express = require('express');
const router = express.Router();
const {
  createDistribution,
  getDistributionsByLoan,
  getAllDistributions,
  updateDistribution,
  deleteDistribution,
} = require('../controllers/distributionController');

// Top-level
router.get('/', getAllDistributions);
router.post('/', createDistribution);
router.put('/:id', updateDistribution);
router.delete('/:id', deleteDistribution);

// Loan-scoped endpoints
router.get('/loan/:loanId', getDistributionsByLoan);
router.post('/loan/:id', createDistribution);

module.exports = router;
