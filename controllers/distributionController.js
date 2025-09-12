const Distribution = require('../models/Distribution');
const Loan = require('../models/Loan');
const { recordMany } = require('../utils/metrics');
const mongoose = require('mongoose');

exports.createDistribution = async (req, res) => {
  try {
    const id = req.params.id || req.body.loan;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid or missing loan id' });
    }

    // Load loan and validate
    const loan = await Loan.findById(id).select('group currency status branchName branchCode client loanOfficerName');
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'active') {
      return res.status(400).json({ error: 'Cannot record distribution for a loan that is not active' });
    }

    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const allowedRoles = ['admin', 'branch head'];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Only admins and branch heads can distribute loans' });
    }

    // Normalize a single entry against the loan
    const normalize = (entry) => {
      const amount = Number(entry.amount || 0);
      if (!(amount > 0)) throw new Error('amount must be greater than 0');

      // Enforce loan currency
      const payloadCurrency = entry.currency ? String(entry.currency) : loan.currency;
      if (payloadCurrency !== loan.currency) {
        throw new Error(`Distribution currency ${payloadCurrency} does not match loan currency ${loan.currency}`);
      }

      // If the loan has a borrower, restrict distribution to that borrower
      let memberId = undefined;
      let memberName = undefined;
      if (loan.client) {
        memberId = loan.client;
        memberName = entry.memberName || '';
      } else {
        memberId = (entry.member && mongoose.Types.ObjectId.isValid(entry.member)) ? entry.member : undefined;
        memberName = entry.memberName || (entry.memberName === '' ? '' : undefined);
      }

      return {
        loan: id,
        group: loan.group,
        member: memberId,
        memberName,
        amount,
        currency: payloadCurrency,
        date: entry.date ? new Date(entry.date) : new Date(),
        notes: entry.notes || '',
        // Derive branch from loan to ensure consistency
        branchName: loan.branchName,
        branchCode: loan.branchCode,
      };
    };

    const { entries } = req.body || {};
    let created;
    if (Array.isArray(entries) && entries.length > 0) {
      const docs = entries.map(normalize);
      created = await Distribution.insertMany(docs);
    } else {
      const payload = normalize(req.body || {});
      created = await Distribution.create(payload);
    }

    // Record metrics for all created entries
    try {
      const arr = Array.isArray(created) ? created : [created];
      const events = arr.flatMap((d) => {
        const base = {
          date: d.date || new Date(),
          branchName: loan.branchName,
          branchCode: loan.branchCode,
          loanOfficerName: loan.loanOfficerName,
          currency: loan.currency,
          loan: id,
          group: loan.group,
          client: loan.client,
          extra: { distribution: d._id },
        };
        return [
          { ...base, metric: 'loanAmountDistributed', value: Number(d.amount || 0) },
          { ...base, metric: 'waitingToBeCollected', value: Number(d.amount || 0) },
        ];
      });
      if (events.length) await recordMany(events);
    } catch (mErr) {
      console.error('[Metrics:createDistribution] failed:', mErr.message);
    }

    // Return refreshed list for this loan
    const distributions = await Distribution.find({ loan: id })
      .populate('member', 'memberName')
      .sort({ date: -1, createdAt: -1 });
    return res.status(201).json(distributions);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getDistributionsByLoan = async (req, res) => {
  try {
    const loanId = req.params.id || req.params.loanId || req.query.loan;
    if (!loanId || !mongoose.Types.ObjectId.isValid(loanId)) {
      return res.status(400).json({ error: 'Invalid or missing loan id' });
    }
    // Access control: must own the loan if restricted
    const loan = await Loan.findById(loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }
    const list = await Distribution.find({ loan: loanId })
      .populate('group member loan')
      .sort({ date: -1, createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllDistributions = async (req, res) => {
  try {
    const { branchName, branchCode } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    // Restrict to user's branch for restricted roles
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!filter.branchCode) filter.branchCode = user.branchCode;
    }
    const list = await Distribution.find(filter).populate('group member loan').sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateDistribution = async (req, res) => {
  try {
    const before = await Distribution.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Distribution not found' });
    // Access control: must own the loan if restricted
    const loan = await Loan.findById(before.loan);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }
    const updated = await Distribution.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ error: 'Distribution not found' });

    // Metrics: compute delta in amount and emit compensating events
    try {
      const loanId = updated.loan || (before && before.loan);
      const amountBefore = Number((before && before.amount) || 0);
      const amountAfter = Number(updated.amount || 0);
      const delta = Number((amountAfter - amountBefore).toFixed(2));
      if (delta !== 0) {
        // Fetch loan officer name
        const loan = await Loan.findById(loanId);
        const base = {
          date: updated.date || new Date(),
          branchName: updated.branchName,
          branchCode: updated.branchCode,
          loanOfficerName: loan ? loan.loanOfficerName : undefined,
          currency: updated.currency,
          loan: loanId,
          group: updated.group,
          client: updated.member,
          extra: { distribution: updated._id, update: true },
        };
        await recordMany([
          { ...base, metric: 'loanAmountDistributed', value: delta },
          { ...base, metric: 'waitingToBeCollected', value: delta },
        ]);
      }
    } catch (mErr) {
      console.error('[Metrics:updateDistribution] failed:', mErr.message);
    }

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteDistribution = async (req, res) => {
  try {
    const existing = await Distribution.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Distribution not found' });
    // Access control: must own the loan if restricted
    const loan = await Loan.findById(existing.loan);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }
    const deleted = await Distribution.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Distribution not found' });

    // Metrics: emit negative to reverse this distribution
    try {
      const loan = await Loan.findById(deleted.loan);
      const base = {
        date: deleted.date || new Date(),
        branchName: deleted.branchName,
        branchCode: deleted.branchCode,
        loanOfficerName: loan ? loan.loanOfficerName : undefined,
        currency: deleted.currency,
        loan: deleted.loan,
        group: deleted.group,
        client: deleted.member,
        extra: { distribution: deleted._id, delete: true },
      };
      const value = -Number(deleted.amount || 0);
      await recordMany([
        { ...base, metric: 'loanAmountDistributed', value },
        { ...base, metric: 'waitingToBeCollected', value },
      ]);
    } catch (mErr) {
      console.error('[Metrics:deleteDistribution] failed:', mErr.message);
    }

    res.json({ message: 'Distribution deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
