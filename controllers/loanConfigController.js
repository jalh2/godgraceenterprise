const LoanConfig = require('../models/LoanConfig');

function isApprover(user) {
  const role = (user && user.role ? String(user.role).toLowerCase() : '');
  return role === 'admin' || role === 'branch head';
}

// Helper to resolve effective config by branchCode (specific or global fallback)
async function getEffectiveConfig(branchCode) {
  const filter = branchCode ? { branchCode } : { branchCode: { $exists: false } };
  const specific = branchCode ? await LoanConfig.findOne({ branchCode }) : null;
  if (specific) return specific;
  const global = await LoanConfig.findOne({ branchCode: { $exists: false } });
  return global || null;
}

exports.getConfig = async (req, res) => {
  try {
    const branchCode = req.query.branchCode || (req.userDoc && req.userDoc.branchCode) || undefined;
    const config = await getEffectiveConfig(branchCode);
    if (!config) return res.json({});
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.upsertConfig = async (req, res) => {
  try {
    const user = req.userDoc || {};
    if (!isApprover(user)) return res.status(403).json({ error: 'Only admins and branch heads can update loan configuration' });
    const branchCode = req.body.branchCode || user.branchCode || null;

    const payload = {
      branchCode: branchCode || undefined,
      express: req.body.express || {},
      individual: req.body.individual || {},
      group: req.body.group || {},
      updatedBy: user.email || user.username || 'system',
    };

    const filter = branchCode ? { branchCode } : { branchCode: { $exists: false } };
    const update = { $set: payload };
    const options = { new: true, upsert: true, setDefaultsOnInsert: true };
    const doc = await LoanConfig.findOneAndUpdate(filter, update, options);
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Export helper for reuse in Loan model
exports.getEffectiveConfig = getEffectiveConfig;
