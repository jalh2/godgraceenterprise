const Distribution = require('../models/Distribution');

exports.createDistribution = async (req, res) => {
  try {
    const loanId = req.params.id || req.body.loan; // support nested and top-level
    if (!loanId) return res.status(400).json({ error: 'loan id is required' });

    // Single or batch via entries: []
    const { entries } = req.body;
    if (Array.isArray(entries) && entries.length > 0) {
      const docs = entries.map((e) => ({ ...e, loan: loanId }));
      const saved = await Distribution.insertMany(docs);
      return res.status(201).json(saved);
    }

    const payload = { ...req.body, loan: loanId };
    const distribution = await Distribution.create(payload);
    res.status(201).json(distribution);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getDistributionsByLoan = async (req, res) => {
  try {
    const loanId = req.params.id || req.params.loanId || req.query.loan;
    if (!loanId) return res.status(400).json({ error: 'loan id is required' });
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
    const list = await Distribution.find(filter).populate('group member loan').sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
