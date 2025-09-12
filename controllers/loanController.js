const Loan = require('../models/Loan');
const mongoose = require('mongoose');
const Group = require('../models/Group');
const { recordMany, computeInterestForLoan, collateralValueFromLoan } = require('../utils/metrics');

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
  } else if (clean.loanType === 'express') {
    // express loans are not tied to a group
    if (Object.prototype.hasOwnProperty.call(clean, 'group')) delete clean.group;
    if (Object.prototype.hasOwnProperty.call(clean, 'clients')) delete clean.clients;
  } else if (clean.loanType === 'individual') {
    // individual loans may be optionally associated with a group (for group member loans)
    if (Object.prototype.hasOwnProperty.call(clean, 'clients')) delete clean.clients;
  }

  return { clean };
}

// Helper: recalculate and persist the aggregated groupLoanTotal based on member individual loans
async function recalcGroupLoanTotal(groupId) {
  if (!groupId) return;
  try {
    const gid = typeof groupId === 'string' ? new mongoose.Types.ObjectId(groupId) : groupId;
    const result = await Loan.aggregate([
      { $match: { group: gid, loanType: 'individual' } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$loanAmount', 0] } } } },
    ]);
    const total = (result && result[0] && result[0].total) || 0;
    await Group.findByIdAndUpdate(gid, { groupLoanTotal: total }, { new: true });
  } catch (err) {
    // Log and continue; don't fail main request due to aggregation issues
    console.error('Failed to recalc groupLoanTotal:', err.message);
  }
}

exports.createLoan = async (req, res) => {
  try {
    const { clean, error } = sanitizeLoanPayload(req.body);
    if (error) return res.status(400).json({ error });
    // Attach creator identity and enforce branch/officer for restricted roles
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (user && user.email) clean.createdByEmail = user.email;
    if (restricted && user) {
      clean.branchName = user.branchName;
      clean.branchCode = user.branchCode;
      clean.loanOfficerName = user.username;
    }
    const loan = await Loan.create(clean);
    // Recalculate group total if applicable
    if (loan && loan.loanType === 'individual' && loan.group) {
      await recalcGroupLoanTotal(loan.group);
    }
    // Metrics: totalCollateral, totalFormFees, totalInspectionFees
    try {
      const date = loan.disbursementDate || loan.createdAt || new Date();
      const base = {
        date,
        branchName: loan.branchName,
        branchCode: loan.branchCode,
        loanOfficerName: loan.loanOfficerName,
        currency: loan.currency,
        loan: loan._id,
        group: loan.group,
        client: loan.client,
        extra: { loanType: loan.loanType },
      };
      const collateral = collateralValueFromLoan(loan);
      const events = [];
      if (collateral && collateral !== 0) events.push({ ...base, metric: 'totalCollateral', value: collateral });
      if (loan.formFeeAmount) events.push({ ...base, metric: 'totalFormFees', value: Number(loan.formFeeAmount || 0) });
      if (loan.inspectionFeeAmount) events.push({ ...base, metric: 'totalInspectionFees', value: Number(loan.inspectionFeeAmount || 0) });
      if (loan.processingFeeAmount) events.push({ ...base, metric: 'totalProcessingFees', value: Number(loan.processingFeeAmount || 0) });
      if (events.length) await recordMany(events);
    } catch (mErr) {
      console.error('[Metrics:createLoan] failed:', mErr.message);
    }
    res.status(201).json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllLoans = async (req, res) => {
  try {
    const { branchName, branchCode, loanType, status, group } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (loanType) filter.loanType = loanType;
    if (status) filter.status = status;
    if (group) filter.group = group;

    // Restrict to creator/officer for loan officer and field agent
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.$or = [
        { createdByEmail: user.email },
        { loanOfficerName: user.username },
      ];
      // Default to user's branch if no explicit filter provided
      if (!branchCode) filter.branchCode = user.branchCode;
    }

    const loans = await Loan.find(filter)
      .populate('group clients client')
      .sort({ createdAt: -1 });
    console.log('[Loans:getAllLoans]', { filter, count: loans.length });
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLoanById = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate('group clients client');
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    // Access control
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateLoan = async (req, res) => {
  try {
    const before = await Loan.findById(req.params.id);
    const { clean, error } = sanitizeLoanPayload(req.body);
    if (error) return res.status(400).json({ error });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      // Must own the loan
      if (!before) return res.status(404).json({ error: 'Loan not found' });
      const own = (before.createdByEmail && before.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (before.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
      // Enforce branch/officer identity
      clean.branchName = user.branchName;
      clean.branchCode = user.branchCode;
      clean.loanOfficerName = user.username;
      clean.createdByEmail = user.email;
    } else if (user && user.email) {
      // Preserve creator if not set
      if (!clean.createdByEmail) clean.createdByEmail = user.email;
    }
    const loan = await Loan.findByIdAndUpdate(req.params.id, clean, { new: true, runValidators: true });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    // Recalculate group totals if relevant loan changed
    const beforeGroup = before && before.loanType === 'individual' ? before.group?.toString() : null;
    const afterGroup = loan && loan.loanType === 'individual' ? loan.group?.toString() : null;
    const groupsToUpdate = new Set();
    if (beforeGroup) groupsToUpdate.add(beforeGroup);
    if (afterGroup) groupsToUpdate.add(afterGroup);
    for (const gid of groupsToUpdate) {
      await recalcGroupLoanTotal(gid);
    }
    res.json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteLoan = async (req, res) => {
  try {
    // Access control
    const existing = await Loan.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Loan not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (existing.createdByEmail && existing.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (existing.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }
    const loan = await Loan.findByIdAndDelete(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.loanType === 'individual' && loan.group) {
      await recalcGroupLoanTotal(loan.group);
    }
    res.json({ message: 'Loan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addCollection = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    // Access control
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }

    // Compute defaults similar to OpportunityMicrofinance
    const toWeeks = (n, unit) => {
      const num = Number(n || 0);
      switch ((unit || '').toLowerCase()) {
        case 'days': return Math.max(Math.ceil(num / 7), 0);
        case 'weeks': return Math.max(num, 0);
        case 'months': return Math.max(num * 4, 0);
        case 'years': return Math.max(num * 52, 0);
        default: return Math.max(num, 0);
      }
    };
    const weeks = toWeeks(loan.loanDurationNumber, loan.loanDurationUnit);
    const expectedWeekly = Number(loan.weeklyInstallment || 0) || (weeks > 0 ? (Number(loan.loanAmount || 0) * (1 + Number(loan.interestRate || 0) / 100)) / weeks : 0);

    // Normalize incoming
    const currency = req.body.currency || loan.currency;
    if (currency !== loan.currency) {
      return res.status(400).json({ error: `Collection currency ${currency} does not match loan currency ${loan.currency}` });
    }
    const weeklyAmount = Number(req.body.weeklyAmount || expectedWeekly);
    const fieldCollection = Number(req.body.fieldCollection || 0);
    const advancePayment = Number(req.body.advancePayment || 0);
    const fieldBalance = (req.body.fieldBalance == null)
      ? Math.max(Number(weeklyAmount || 0) - fieldCollection - advancePayment, 0)
      : Number(req.body.fieldBalance);
    const memberName = req.body.memberName || (loan.client ? undefined : '');

    const record = {
      memberName: memberName || (req.body.memberName || ''),
      loanAmount: Number(req.body.loanAmount || weeklyAmount),
      weeklyAmount,
      fieldCollection,
      advancePayment,
      fieldBalance,
      currency,
      collectionDate: req.body.collectionDate || new Date(),
    };
    // If per-client loan and memberName missing, try to populate from client
    if (!record.memberName && loan.client) {
      try {
        const Client = require('../models/Client');
        const c = await Client.findById(loan.client).select('memberName');
        if (c && c.memberName) record.memberName = c.memberName;
      } catch (_) {}
    }

    loan.collections.push(record);
    loan.totalRealization = Number(loan.totalRealization || 0) + Number(record.fieldCollection || 0);
    await loan.save();

    // Metrics for single collection
    try {
      const overdueVal = Math.max(Number(record.weeklyAmount || 0) - Number(record.fieldCollection || 0), 0);
      const base = {
        date: record.collectionDate || new Date(),
        branchName: loan.branchName,
        branchCode: loan.branchCode,
        loanOfficerName: loan.loanOfficerName,
        currency: record.currency || loan.currency,
        loan: loan._id,
        group: loan.group,
        client: loan.client,
        extra: { collectionIdx: loan.collections.length - 1 },
      };
      const events = [
        { ...base, metric: 'totalCollectionsCollected', value: Number(record.fieldCollection || 0) },
        { ...base, metric: 'waitingToBeCollected', value: -Number(record.fieldCollection || 0) },
      ];
      if (overdueVal > 0) events.push({ ...base, metric: 'overdue', value: overdueVal });
      await recordMany(events);
    } catch (mErr) {
      console.error('[Metrics:addCollection] failed:', mErr.message);
    }

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
    // Access control
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }

    // Defaults
    const toWeeks = (n, unit) => {
      const num = Number(n || 0);
      switch ((unit || '').toLowerCase()) {
        case 'days': return Math.max(Math.ceil(num / 7), 0);
        case 'weeks': return Math.max(num, 0);
        case 'months': return Math.max(num * 4, 0);
        case 'years': return Math.max(num * 52, 0);
        default: return Math.max(num, 0);
      }
    };
    const weeks = toWeeks(loan.loanDurationNumber, loan.loanDurationUnit);
    const expectedWeekly = Number(loan.weeklyInstallment || 0) || (weeks > 0 ? (Number(loan.loanAmount || 0) * (1 + Number(loan.interestRate || 0) / 100)) / weeks : 0);

    let totalAdd = 0;
    for (const entry of entries) {
      const currency = entry.currency || loan.currency;
      if (currency !== loan.currency) {
        return res.status(400).json({ error: `Collection currency ${currency} does not match loan currency ${loan.currency}` });
      }
      const weeklyAmount = Number(entry.weeklyAmount || expectedWeekly);
      const fieldCollection = Number(entry.fieldCollection || 0);
      const advancePayment = Number(entry.advancePayment || 0);
      const fieldBalance = (entry.fieldBalance == null)
        ? Math.max(Number(weeklyAmount || 0) - fieldCollection - advancePayment, 0)
        : Number(entry.fieldBalance);
      const rec = {
        memberName: entry.memberName || '',
        loanAmount: Number(entry.loanAmount || weeklyAmount),
        weeklyAmount,
        fieldCollection,
        advancePayment,
        fieldBalance,
        currency,
        collectionDate: entry.collectionDate || new Date(),
      };
      loan.collections.push(rec);
      totalAdd += Number(rec.fieldCollection || 0);
    }

    loan.totalRealization = Number(loan.totalRealization || 0) + totalAdd;
    await loan.save();

    // Metrics for batch
    try {
      const events = [];
      let totalCollected = 0;
      for (let i = 0; i < entries.length; i++) {
        const rec = entries[i];
        const collected = Number(rec.fieldCollection || 0);
        const overdueVal = Math.max(Number(rec.weeklyAmount || 0) - collected, 0);
        totalCollected += collected;
        const base = {
          date: rec.collectionDate || new Date(),
          branchName: loan.branchName,
          branchCode: loan.branchCode,
          loanOfficerName: loan.loanOfficerName,
          currency: rec.currency || loan.currency,
          loan: loan._id,
          group: loan.group,
          client: loan.client,
          extra: { batch: true, entryIndex: i },
        };
        events.push({ ...base, metric: 'totalCollectionsCollected', value: collected });
        events.push({ ...base, metric: 'waitingToBeCollected', value: -collected });
        if (overdueVal > 0) events.push({ ...base, metric: 'overdue', value: overdueVal });
      }
      if (events.length) await recordMany(events);
    } catch (mErr) {
      console.error('[Metrics:addCollectionsBatch] failed:', mErr.message);
    }

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
    // Access control: must own loan for restricted roles
    const current = await Loan.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Loan not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const own = (current.createdByEmail && current.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (current.loanOfficerName === user.username);
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }
    // Only admin/branch head can approve (activate) loans
    if (status === 'active') {
      const roleForApprove = (user && user.role ? String(user.role).toLowerCase() : '');
      const approvers = ['admin', 'branch head'];
      if (!approvers.includes(roleForApprove)) {
        return res.status(403).json({ error: 'Only admins and branch heads can approve loans' });
      }
    }

    // Helper: convert loan duration to weeks (approximate months=4 weeks, years=52 weeks)
    const toWeeks = (n, unit) => {
      const num = Number(n || 0);
      switch ((unit || '').toLowerCase()) {
        case 'days': return Math.max(Math.ceil(num / 7), 0);
        case 'weeks': return Math.max(num, 0);
        case 'months': return Math.max(num * 4, 0);
        case 'years': return Math.max(num * 52, 0);
        default: return Math.max(num, 0);
      }
    };

    // Prepare update doc and compute weekly installment on activation
    const update = { status };
    const prevStatus = current.status;
    if (prevStatus !== 'active' && status === 'active') {
      // If disbursementDate missing, set to now to align future metrics
      if (!current.disbursementDate) update.disbursementDate = new Date();
      const weeks = toWeeks(current.loanDurationNumber, current.loanDurationUnit);
      if (weeks > 0 && Number.isFinite(current.loanAmount)) {
        const ratePct = Number(current.interestRate || 0);
        const totalRepayable = Number(current.loanAmount) * (1 + (ratePct / 100));
        const weekly = totalRepayable / weeks; // per-loan weekly installment
        update.weeklyInstallment = Math.round(weekly * 100) / 100;
      }
    }
    const loan = await Loan.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.loanType === 'individual' && loan.group) {
      await recalcGroupLoanTotal(loan.group);
    }
    // Metrics: when loan becomes active, record interestCollected (planned interest)
    try {
      if (status === 'active') {
        const interest = computeInterestForLoan(loan);
        if (interest && !isNaN(interest)) {
          await recordMany([
            {
              metric: 'interestCollected',
              value: Number(interest || 0),
              date: loan.disbursementDate || loan.updatedAt || new Date(),
              branchName: loan.branchName,
              branchCode: loan.branchCode,
              loanOfficerName: loan.loanOfficerName,
              currency: loan.currency,
              loan: loan._id,
              group: loan.group,
              client: loan.client,
              extra: { statusChange: 'active' },
            },
          ]);
        }
        // For non-group loans (express/individual), record disbursement and initial waiting balance
        if (loan.loanType !== 'group') {
          const events = [
            {
              metric: 'loanAmountDistributed',
              value: Number(loan.netDisbursedAmount || loan.loanAmount || 0),
              date: loan.disbursementDate || loan.updatedAt || new Date(),
              branchName: loan.branchName,
              branchCode: loan.branchCode,
              loanOfficerName: loan.loanOfficerName,
              currency: loan.currency,
              loan: loan._id,
              group: loan.group,
              client: loan.client,
              extra: { statusChange: 'active' },
            },
            {
              metric: 'waitingToBeCollected',
              value: Number(loan.loanAmount || 0) || 0,
              date: loan.disbursementDate || loan.updatedAt || new Date(),
              branchName: loan.branchName,
              branchCode: loan.branchCode,
              loanOfficerName: loan.loanOfficerName,
              currency: loan.currency,
              loan: loan._id,
              group: loan.group,
              client: loan.client,
              extra: { statusChange: 'active' },
            },
          ];
          await recordMany(events);
        }
      }
    } catch (mErr) {
      console.error('[Metrics:setLoanStatus] failed:', mErr.message);
    }
    res.json(loan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// List loans by group (primarily individual loans for group members)
exports.getLoansByGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    // Access control: ensure user owns the group when restricted
    try {
      const g = await Group.findById(groupId);
      if (!g) return res.status(404).json({ error: 'Group not found' });
      const user = req.userDoc;
      const role = (user && user.role ? String(user.role).toLowerCase() : '');
      const restricted = role === 'loan officer' || role === 'field agent';
      if (restricted && user) {
        if (!g.createdByEmail || g.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
    } catch (e) {}
    const { loanType, status } = req.query;
    const filter = { group: groupId };
    if (loanType) filter.loanType = loanType;
    if (status) filter.status = status;
    const loans = await Loan.find(filter)
      .populate('group client')
      .sort({ createdAt: -1 });
    console.log('[Loans:getByGroup]', { groupId, filter, count: loans.length });
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
