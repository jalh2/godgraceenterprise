const express = require('express');
const router = express.Router();
const {
  createLoan,
  getAllLoans,
  getDueCollections,
  getLoanById,
  updateLoan,
  deleteLoan,
  addCollection,
  addCollectionsBatch,
  setLoanStatus,
  getLoansByGroup,
} = require('../controllers/loanController');
const { getDistributionsByLoan, createDistribution } = require('../controllers/distributionController');
const { getAgreementForLoan, initAgreementForLoan, updateAgreementForLoan } = require('../controllers/loanAgreementController');

router.post('/', createLoan);
router.get('/', getAllLoans);
// Daily/weekly due collections listing
router.get('/due-collections', getDueCollections);
// Group-scoped listing (primarily individual loans for group members)
router.get('/by-group/:groupId', getLoansByGroup);
router.get('/:id', getLoanById);
router.put('/:id', updateLoan);
router.patch('/:id/status', setLoanStatus);
router.delete('/:id', deleteLoan);

router.post('/:id/collections', addCollection);
router.post('/:id/collections/batch', addCollectionsBatch);

router.get('/:id/distributions', getDistributionsByLoan);
router.post('/:id/distributions', createDistribution);

// Loan Agreement endpoints
router.get('/:id/agreement', getAgreementForLoan);
router.post('/:id/agreement/init', initAgreementForLoan);
router.put('/:id/agreement', updateAgreementForLoan);

module.exports = router;
