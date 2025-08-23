const express = require('express');
const router = express.Router();
const {
  createSavingsAccount,
  getAllSavingsAccounts,
  getSavingsAccountById,
  addTransaction,
} = require('../controllers/savingsController');

router.post('/', createSavingsAccount);
router.get('/', getAllSavingsAccounts);
router.get('/:id', getSavingsAccountById);
router.post('/:id/transactions', addTransaction);

module.exports = router;
