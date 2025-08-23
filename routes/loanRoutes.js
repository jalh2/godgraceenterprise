const express = require('express');
const router = express.Router();
const {
  createLoan,
  getAllLoans,
  getLoanById,
  updateLoan,
  deleteLoan,
  addCollection,
  addCollectionsBatch,
  setLoanStatus,
} = require('../controllers/loanController');
const { getDistributionsByLoan, createDistribution } = require('../controllers/distributionController');

router.post('/', createLoan);
router.get('/', getAllLoans);
router.get('/:id', getLoanById);
router.put('/:id', updateLoan);
router.patch('/:id/status', setLoanStatus);
router.delete('/:id', deleteLoan);

router.post('/:id/collections', addCollection);
router.post('/:id/collections/batch', addCollectionsBatch);

router.get('/:id/distributions', getDistributionsByLoan);
router.post('/:id/distributions', createDistribution);

module.exports = router;
