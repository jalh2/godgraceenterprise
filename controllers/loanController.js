const Loan = require('../models/Loan');
const mongoose = require('mongoose');

// Helper to sanitize and validate incoming loan payload
function sanitizeLoanPayload(payload) {
  const clean = { ...payload };

  // Normalize optional relational fields: remove if empty string/null/undefined
  if (Object.prototype.hasOwnProperty.call(clean, 'group')) {
    if (!clean.group) {
      delete clean.group;
    } else if (!mongoose.Types.ObjectId.isValid(clean.group)) {
      return { error: 'Invalid group id' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(clean, 'client')) {
    if (!clean.client) {
      delete clean.client;
    } else if (!mongoose.Types.ObjectId.isValid(clean.client)) {
      return { error: 'Invalid client id' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(clean, 'clients')) {
    if (!Array.isArray(clean.clients) || clean.clients.length === 0) {
      delete clean.clients;
    } else {
      clean.clients = clean.clients.filter(Boolean);
      if (clean.clients.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        return { error: 'One or more client ids are invalid' };
      }
    }
  }

  // Type-specific pruning to avoid contradictory fields
  if (clean.loanType === 'group') {
    // group loans should not carry single client field
    if (Object.prototype.hasOwnProperty.call(clean, 'client')) delete clean.client;
  } else if (clean.loanType === 'individual' || clean.loanType === 'express') {
    // non-group loans should not carry group/clients fields
    if (Object.prototype.hasOwnProperty.call(clean, 'group')) delete clean.group;
    if (Object.prototype.hasOwnProperty.call(clean, 'clients')) delete clean.clients;
  }

  return { clean };
}

exports.createLoan = async (req, res) => {
  try {
    const { clean, error } = sanitizeLoanPayload(req.body);
    if (error) return res.status(400).json({ error });
    const loan = await Loan.create(clean);
    res.status(201).json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllLoans = async (req, res) => {
  try {
    const { branchName, branchCode, loanType, status } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (loanType) filter.loanType = loanType;
    if (status) filter.status = status;

    const loans = await Loan.find(filter)
      .populate('group clients client')
      .sort({ createdAt: -1 });
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate('group clients client');
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateLoan = async (req, res) => {
  try {
    const { clean, error } = sanitizeLoanPayload(req.body);
    if (error) return res.status(400).json({ error });
    const loan = await Loan.findByIdAndUpdate(req.params.id, clean, { new: true, runValidators: true });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findByIdAndDelete(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json({ message: 'Loan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addCollection = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const record = {
      memberName: req.body.memberName,
      loanAmount: req.body.loanAmount,
      weeklyAmount: req.body.weeklyAmount,
      fieldCollection: req.body.fieldCollection,
      advancePayment: req.body.advancePayment || 0,
      fieldBalance: req.body.fieldBalance,
      currency: req.body.currency || loan.currency,
      collectionDate: req.body.collectionDate || new Date(),
    };

    loan.collections.push(record);
    loan.totalRealization = Number(loan.totalRealization || 0) + Number(record.fieldCollection || 0);
    await loan.save();

    res.status(201).json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.addCollectionsBatch = async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array is required' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    let totalAdd = 0;
    for (const entry of entries) {
      const rec = {
        memberName: entry.memberName,
        loanAmount: entry.loanAmount,
        weeklyAmount: entry.weeklyAmount,
        fieldCollection: entry.fieldCollection,
        advancePayment: entry.advancePayment || 0,
        fieldBalance: entry.fieldBalance,
        currency: entry.currency || loan.currency,
        collectionDate: entry.collectionDate || new Date(),
      };
      loan.collections.push(rec);
      totalAdd += Number(rec.fieldCollection || 0);
    }

    loan.totalRealization = Number(loan.totalRealization || 0) + totalAdd;
    await loan.save();

    res.status(201).json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.setLoanStatus = async (req, res) => {
  try {
    const allowed = ['pending', 'active', 'paid', 'defaulted'];
    const { status } = req.body;
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const loan = await Loan.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    res.json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
