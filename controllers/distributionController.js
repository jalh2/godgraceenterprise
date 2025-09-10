const Distribution = require('../models/Distribution');
const Loan = require('../models/Loan');
const { recordMany } = require('../utils/metrics');

exports.createDistribution = async (req, res) => {
  try {
    const loanId = req.params.id || req.body.loan; // support nested and top-level
    if (!loanId) return res.status(400).json({ error: 'loan id is required' });

    // Single or batch via entries: []
    const { entries } = req.body;
    if (Array.isArray(entries) && entries.length > 0) {
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
      const docs = entries.map((e) => ({ ...e, loan: loanId }));
      const saved = await Distribution.insertMany(docs);

      // Metrics: loanAmountDistributed (+), waitingToBeCollected (+)
      // loan already fetched
      const events = saved.flatMap((d) => {
        const base = {
          date: d.date || new Date(),
          branchName: d.branchName,
          branchCode: d.branchCode,
          loanOfficerName: loan ? loan.loanOfficerName : undefined,
          currency: d.currency,
          loan: loanId,
          group: d.group,
          client: d.member,
          extra: { distribution: d._id },
        };
        return [
          { ...base, metric: 'loanAmountDistributed', value: Number(d.amount || 0) },
          { ...base, metric: 'waitingToBeCollected', value: Number(d.amount || 0) },
        ];
      });
      await recordMany(events);

      return res.status(201).json(saved);
    }

    const payload = { ...req.body, loan: loanId };
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
    const distribution = await Distribution.create(payload);

    // Metrics for single record
    // loan already fetched
    await recordMany([
      {
        metric: 'loanAmountDistributed',
        value: Number(distribution.amount || 0),
        date: distribution.date || new Date(),
        branchName: distribution.branchName,
        branchCode: distribution.branchCode,
        loanOfficerName: loan ? loan.loanOfficerName : undefined,
        currency: distribution.currency,
        loan: loanId,
        group: distribution.group,
        client: distribution.member,
        extra: { distribution: distribution._id },
      },
      {
        metric: 'waitingToBeCollected',
        value: Number(distribution.amount || 0),
        date: distribution.date || new Date(),
        branchName: distribution.branchName,
        branchCode: distribution.branchCode,
        loanOfficerName: loan ? loan.loanOfficerName : undefined,
        currency: distribution.currency,
        loan: loanId,
        group: distribution.group,
        client: distribution.member,
        extra: { distribution: distribution._id },
      },
    ]);

    res.status(201).json(distribution);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getDistributionsByLoan = async (req, res) => {
  try {
    const loanId = req.params.id || req.params.loanId || req.query.loan;
    if (!loanId) return res.status(400).json({ error: 'loan id is required' });
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
    const list = await Distribution.find({ loan: loanId }).populate('group member loan').sort({ createdAt: -1 });
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
