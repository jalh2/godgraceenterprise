const SavingsAccount = require('../models/Savings');

exports.createSavingsAccount = async (req, res) => {
  try {
    const {
      accountType = 'individual',
      client,
      group,
      branchName,
      branchCode,
      loanCycle,
      currency,
    } = req.body;

    if (!branchName || !branchCode) {
      return res.status(400).json({ error: 'branchName and branchCode are required' });
    }

    if (accountType === 'individual') {
      if (!client) return res.status(400).json({ error: 'client is required for individual savings' });
      const existing = await SavingsAccount.findOne({ accountType: 'individual', client });
      if (existing) return res.status(400).json({ error: 'Savings account already exists for this client' });
      const account = await SavingsAccount.create({
        accountType: 'individual',
        client,
        group: group || undefined,
        branchName,
        branchCode,
        loanCycle,
        currency,
      });
      return res.status(201).json(account);
    }

    if (accountType === 'group') {
      if (!group) return res.status(400).json({ error: 'group is required for group savings' });
      const existing = await SavingsAccount.findOne({ accountType: 'group', group });
      if (existing) return res.status(400).json({ error: 'Savings account already exists for this group' });
      const account = await SavingsAccount.create({
        accountType: 'group',
        group,
        client: undefined,
        branchName,
        branchCode,
        loanCycle,
        currency,
      });
      return res.status(201).json(account);
    }

    return res.status(400).json({ error: 'Invalid accountType' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllSavingsAccounts = async (req, res) => {
  try {
    const { branchName, branchCode, accountType } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (accountType === 'individual') {
      // Treat missing accountType as individual for backward compatibility
      filter.$or = [{ accountType: 'individual' }, { accountType: { $exists: false } }];
    } else if (accountType === 'group') {
      filter.accountType = 'group';
    }
    const accounts = await SavingsAccount.find(filter).populate('client group').sort({ createdAt: -1 });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSavingsAccountById = async (req, res) => {
  try {
    const account = await SavingsAccount.findById(req.params.id).populate('client group');
    if (!account) return res.status(404).json({ error: 'Savings account not found' });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addTransaction = async (req, res) => {
  try {
    const { savingAmount = 0, withdrawalAmount = 0, currency, tellerSignature, managerSignature } = req.body;
    const account = await SavingsAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Savings account not found' });

    const prev = account.currentBalance || 0;
    const newBalance = prev + Number(savingAmount || 0) - Number(withdrawalAmount || 0);

    const txn = {
      savingAmount,
      withdrawalAmount,
      balance: newBalance,
      currency: currency || account.currency,
      tellerSignature,
      managerSignature,
      branchName: req.body.branchName || account.branchName,
      branchCode: req.body.branchCode || account.branchCode,
      date: new Date(),
    };

    account.transactions.push(txn);
    account.currentBalance = newBalance;
    await account.save();

    res.status(201).json(account);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
