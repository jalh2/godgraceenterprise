const express = require('express');
const router = express.Router();
const { requireUser } = require('../middleware/roleGuard');
const controller = require('../controllers/loanConfigController');

// Get effective config for current branch (or specified via ?branchCode=)
router.get('/', requireUser, controller.getConfig);

// Upsert config for branch (admins/branch heads only)
router.put('/', requireUser, controller.upsertConfig);

module.exports = router;
