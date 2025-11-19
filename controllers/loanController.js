const Loan = require('../models/Loan');
const LoanAgreement = require('../models/LoanAgreement');
const { mapAgreementFromLoan } = require('./loanAgreementController');
const mongoose = require('mongoose');
const Group = require('../models/Group');
const Client = require('../models/Client');
const { recordMany, computeInterestForLoan, collateralValueFromLoan } = require('../utils/metrics');
const SavingsAccount = require('../models/Savings');

// Helper to sanitize and validate incoming loan payload
function sanitizeLoanPayload(payload) {
  const clean = { ...payload };
  const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

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

  // Drop empty-string enum fields to avoid enum validation errors
  if (Object.prototype.hasOwnProperty.call(clean, 'maritalStatus') && isBlank(clean.maritalStatus)) {
    delete clean.maritalStatus;
  }
  if (clean.creditorInfo) {
    if (Object.prototype.hasOwnProperty.call(clean.creditorInfo, 'sex') && isBlank(clean.creditorInfo.sex)) {
      delete clean.creditorInfo.sex;
    }
    // Remove empty nested object to avoid storing empty docs
    if (Object.keys(clean.creditorInfo).every((k) => isBlank(clean.creditorInfo[k]))) {
      delete clean.creditorInfo;
    }
  }
  if (Array.isArray(clean.guarantors)) {
    clean.guarantors = clean.guarantors.map((g) => {
      if (!g) return g;
      const gg = { ...g };
      if (Object.prototype.hasOwnProperty.call(gg, 'sex') && isBlank(gg.sex)) delete gg.sex;
      return gg;
    });
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
    const role = (user && user.role ? String(user.role).trim().toLowerCase() : '');
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
      if (loan.collateralCashAmount) events.push({ ...base, metric: 'collateralCashRequired', value: Number(loan.collateralCashAmount || 0) });
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
    const role = (user && user.role ? String(user.role).trim().toLowerCase() : '');
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

// List due collections by date range (default: today). Returns schedule-aware entries per loan/date.
// Query params:
// - from: YYYY-MM-DD (inclusive), default: today
// - to: YYYY-MM-DD (inclusive), default: same as from
// - daysAhead: number (optional) when 'to' not provided; computes to = from + daysAhead
// - branchCode, branchName, loanType, status (default 'active')
// - currency (optional)
exports.getDueCollections = async (req, res) => {
  try {
    const safeKey = (d) => {
      const nd = d ? new Date(d) : null;
      return nd && !isNaN(nd) ? nd.toISOString().slice(0, 10) : '';
    };

    // Parse range
    const todayKey = safeKey(new Date());
    let fromKey = String(req.query.from || '').slice(0, 10);
    if (!fromKey || fromKey.length !== 10) fromKey = todayKey;
    let toKey = String(req.query.to || '').slice(0, 10);
    if (!toKey || toKey.length !== 10) {
      const daysAhead = Number(req.query.daysAhead || 0);
      if (daysAhead && Number.isFinite(daysAhead)) {
        const d = new Date(fromKey);
        d.setDate(d.getDate() + daysAhead);
        toKey = safeKey(d);
      } else {
        toKey = fromKey;
      }
    }

    // Build DB filter
    const { branchCode, branchName, loanType, status, currency } = req.query;
    const filter = {};
    if (branchCode) filter.branchCode = branchCode;
    if (branchName) filter.branchName = branchName;
    if (loanType) filter.loanType = loanType;
    if (status) filter.status = status; else filter.status = 'active';
    if (currency) filter.currency = currency;

    // Restrict to creator/officer for restricted roles (loan officer/field agent)
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).trim().toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.$or = [
        { createdByEmail: user.email },
        { loanOfficerName: user.username },
      ];
      if (!branchCode) filter.branchCode = user.branchCode;
    }

    // Fetch necessary fields only
    const loans = await Loan.find(filter)
      .select(
        'loanType group client collections loanAmount interestRate currency paymentPlan loanDurationNumber loanDurationUnit disbursementDate collectionStartDate endingDate branchName branchCode loanOfficerName createdAt status'
      )
      .populate('client', 'memberName')
      .populate('group', 'groupName')
      .sort({ createdAt: -1 })
      .lean();

    const addMonths = (base, n) => {
      const d = new Date(base);
      const day = d.getDate();
      d.setMonth(d.getMonth() + n);
      if (d.getDate() !== day) {
        // JS adjusts end-of-month; accept it
      }
      return d;
    };
    const toWeeks = (n, unit) => {
      const num = Number(n || 0);
      switch (String(unit || '').toLowerCase()) {
        case 'days': return Math.max(Math.ceil(num / 7), 0);
        case 'weeks': return Math.max(num, 0);
        case 'months': return Math.max(num * 4, 0);
        case 'years': return Math.max(num * 52, 0);
        default: return Math.max(num, 0);
      }
    };

    const items = [];
    for (const loan of loans) {
      const plan = String(loan.paymentPlan || 'weekly').toLowerCase();
      const totalWithInterest = Number(loan.loanAmount || 0) * (1 + Number(loan.interestRate || 0) / 100);
      const start = loan.collectionStartDate ? new Date(loan.collectionStartDate) : (loan.disbursementDate ? new Date(loan.disbursementDate) : (loan.createdAt ? new Date(loan.createdAt) : null));
      const end = loan.endingDate ? new Date(loan.endingDate) : null;
      const dates = [];
      if (start && end && !isNaN(start) && !isNaN(end)) {
        let i = 0; let current = new Date(start);
        while (current <= end && i < 500) {
          dates.push(safeKey(current));
          if (plan === 'weekly') current.setDate(current.getDate() + 7);
          else if (plan === 'bi-weekly') current.setDate(current.getDate() + 14);
          else current = addMonths(current, 1);
          i += 1;
        }
      } else {
        const weeks = toWeeks(loan.loanDurationNumber, loan.loanDurationUnit);
        let periods = 0;
        if (plan === 'weekly') periods = weeks;
        else if (plan === 'bi-weekly') periods = Math.max(Math.ceil(weeks / 2), 0);
        else {
          const n = Number(loan.loanDurationNumber || 0);
          const unit = String(loan.loanDurationUnit || 'weeks').toLowerCase();
          let months = 0;
          switch (unit) {
            case 'days': months = Math.max(Math.ceil(n / 30), 0); break;
            case 'weeks': months = Math.max(Math.ceil(weeks / 4), 0); break;
            case 'months': months = Math.max(n, 0); break;
            case 'years': months = Math.max(n * 12, 0); break;
            default: months = Math.max(n, 0); break;
          }
          periods = months;
        }
        const count = Math.max(periods, 0);
        for (let i = 0; i < count; i++) {
          const d = new Date(start || new Date());
          if (plan === 'weekly') d.setDate(d.getDate() + i * 7);
          else if (plan === 'bi-weekly') d.setDate(d.getDate() + i * 14);
          else d.setMonth(d.getMonth() + i);
          dates.push(safeKey(d));
        }
      }

      if (!dates.length) continue; // skip loans without any schedule

      const periods = Math.max(dates.length, 1);
      const baseDue = periods > 0 ? (totalWithInterest / periods) : 0;
      const collections = Array.isArray(loan.collections) ? loan.collections : [];
      const key = (c) => safeKey(c.collectionDate);

      for (let i = 0; i < dates.length; i++) {
        const dateStr = dates[i];
        if (dateStr < fromKey || dateStr > toKey) continue;
        const expected = (i === periods - 1 && periods > 0)
          ? Math.max(totalWithInterest - baseDue * (periods - 1), 0)
          : baseDue;

        const collectedOnDate = collections
          .filter((c) => key(c) === dateStr)
          .reduce((s, c) => s + Number(c.fieldCollection || 0), 0);
        const paidBefore = collections
          .filter((c) => key(c) < dateStr)
          .reduce((s, c) => s + Number(c.fieldCollection || 0), 0);
        const outstandingBefore = Math.max(totalWithInterest - paidBefore, 0);
        const scheduledRemainingAfter = Math.max(totalWithInterest - (i === periods - 1 ? totalWithInterest : baseDue * (i + 1)), 0);
        const overdue = Math.max(Number(expected || 0) - Number(collectedOnDate || 0), 0);

        items.push({
          loan: String(loan._id),
          loanType: loan.loanType,
          branchName: loan.branchName,
          branchCode: loan.branchCode,
          loanOfficerName: loan.loanOfficerName,
          currency: loan.currency,
          clientName: loan.client && loan.client.memberName ? loan.client.memberName : null,
          groupName: loan.group && loan.group.groupName ? loan.group.groupName : null,
          dueDate: dateStr,
          periodIndex: i + 1,
          periods,
          scheduledAmount: Math.round(Number(expected || 0) * 100) / 100,
          collectedOnDate: Math.round(Number(collectedOnDate || 0) * 100) / 100,
          overdue: Math.round(Number(overdue || 0) * 100) / 100,
          outstandingBefore: Math.round(Number(outstandingBefore || 0) * 100) / 100,
          scheduledRemainingAfter: Math.round(Number(scheduledRemainingAfter || 0) * 100) / 100,
        });
      }
    }

    // Sort by dueDate asc, then overdue desc
    items.sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return (Number(b.overdue || 0) - Number(a.overdue || 0));
    });

    res.json({ range: { from: fromKey, to: toKey }, count: items.length, items });
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
    const role = (user && user.role ? String(user.role).trim().toLowerCase() : '');
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
    // Clean up metrics associated with this loan
    try {
      const Metric = require('../models/Metric');
      await Metric.deleteMany({ loan: loan._id });
    } catch (mErr) {
      console.error('Failed to delete metrics for loan:', mErr);
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

    // Compute defaults based on payment plan (weekly/bi-weekly/monthly)
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
    const plan = String(loan.paymentPlan || 'weekly').toLowerCase();
    const totalWithInterest = Number(loan.loanAmount || 0) * (1 + Number(loan.interestRate || 0) / 100);
    const calcPeriods = () => {
      const start = (loan.collectionStartDate ? new Date(loan.collectionStartDate) : (loan.disbursementDate ? new Date(loan.disbursementDate) : null));
      const end = loan.endingDate ? new Date(loan.endingDate) : null;
      if (!loan.collectionStartDate && start && end && !isNaN(start) && !isNaN(end)) {
        let i = 0;
        let current = new Date(start);
        while (current <= end && i < 500) {
          if (plan === 'weekly') current.setDate(current.getDate() + 7);
          else if (plan === 'bi-weekly') current.setDate(current.getDate() + 14);
          else current.setMonth(current.getMonth() + 1);
          i += 1;
        }
        return i;
      }
      const weeks = toWeeks(loan.loanDurationNumber, loan.loanDurationUnit);
      if (plan === 'weekly') return weeks;
      if (plan === 'bi-weekly') return Math.max(Math.ceil(weeks / 2), 0);
      // monthly fallback using approximate months from duration
      const n = Number(loan.loanDurationNumber || 0);
      const unit = String(loan.loanDurationUnit || 'weeks').toLowerCase();
      let months = 0;
      switch (unit) {
        case 'days': months = Math.max(Math.ceil(n / 30), 0); break;
        case 'weeks': months = Math.max(Math.ceil(weeks / 4), 0); break;
        case 'months': months = Math.max(n, 0); break;
        case 'years': months = Math.max(n * 12, 0); break;
        default: months = Math.max(n, 0); break;
      }
      return months;
    };
    const periods = Math.max(calcPeriods(), 1);
    const expectedWeekly = periods > 0 ? (totalWithInterest / periods) : 0;

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

    // Defaults using payment plan (weekly/bi-weekly/monthly)
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
    const plan = String(loan.paymentPlan || 'weekly').toLowerCase();
    const totalWithInterest = Number(loan.loanAmount || 0) * (1 + Number(loan.interestRate || 0) / 100);
    const calcPeriods = () => {
      const start = (loan.collectionStartDate ? new Date(loan.collectionStartDate) : (loan.disbursementDate ? new Date(loan.disbursementDate) : null));
      const end = loan.endingDate ? new Date(loan.endingDate) : null;
      if (start && end && !isNaN(start) && !isNaN(end)) {
        let i = 0; let current = new Date(start);
        while (current <= end && i < 500) {
          if (plan === 'weekly') current.setDate(current.getDate() + 7);
          else if (plan === 'bi-weekly') current.setDate(current.getDate() + 14);
          else current.setMonth(current.getMonth() + 1);
          i += 1;
        }
        return i;
      }
      const weeks = toWeeks(loan.loanDurationNumber, loan.loanDurationUnit);
      if (plan === 'weekly') return weeks;
      if (plan === 'bi-weekly') return Math.max(Math.ceil(weeks / 2), 0);
      // monthly fallback
      const n = Number(loan.loanDurationNumber || 0);
      const unit = String(loan.loanDurationUnit || 'weeks').toLowerCase();
      let months = 0;
      switch (unit) {
        case 'days': months = Math.max(Math.ceil(n / 30), 0); break;
        case 'weeks': months = Math.max(Math.ceil(weeks / 4), 0); break;
        case 'months': months = Math.max(n, 0); break;
        case 'years': months = Math.max(n * 12, 0); break;
        default: months = Math.max(n, 0); break;
      }
      return months;
    };
    const periods = Math.max(calcPeriods(), 1);
    const expectedWeekly = periods > 0 ? (totalWithInterest / periods) : 0;

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
      let memberName = entry.memberName || '';
      if (!memberName && loan.client) {
        try {
          const Client = require('../models/Client');
          const c = await Client.findById(loan.client).select('memberName');
          if (c && c.memberName) memberName = c.memberName;
        } catch (_) {}
      }
      const rec = {
        memberName,
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
    // Require authenticated identity for status changes
    if (!req.userDoc) {
      return res.status(401).json({ error: 'Authentication required. Please include x-user-email header.' });
    }
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
      const roleForApprove = (user && user.role ? String(user.role).trim().toLowerCase() : '');
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
    // Auto-create Loan Agreement upon approval (activation)
    try {
      if (status === 'active') {
        const existingAgreement = await LoanAgreement.findOne({ loan: loan._id });
        if (!existingAgreement) {
          const payload = mapAgreementFromLoan(loan);
          await LoanAgreement.create(payload);
        }
      }
    } catch (aErr) {
      console.error('[Agreement:setLoanStatus] failed to ensure agreement:', aErr.message);
    }
    // Auto-create collateral savings account and deposit collateral upon activation
    try {
      if (status === 'active') {
        // Only for loans tied to a single client (express/individual) and positive collateral amount
        const hasClient = !!loan.client;
        const collateralAmt = Number(loan.collateralCashAmount || 0);
        if (hasClient && collateralAmt > 0) {
          // Ensure individual savings account exists for this client
          let account = await SavingsAccount.findOne({ accountType: 'individual', client: loan.client });
          if (!account) {
            account = await SavingsAccount.create({
              accountType: 'individual',
              client: loan.client,
              group: loan.group || undefined,
              branchName: loan.branchName,
              branchCode: loan.branchCode,
              loanCycle: 1,
              currency: loan.currency,
            });
          }
          // Deposit the collateral into the savings account
          const prev = Number(account.currentBalance || 0);
          const newBalance = prev + collateralAmt;
          account.transactions.push({
            date: loan.disbursementDate || new Date(),
            savingAmount: collateralAmt,
            withdrawalAmount: 0,
            balance: newBalance,
            currency: account.currency,
            tellerSignature: undefined,
            managerSignature: undefined,
            branchName: loan.branchName,
            branchCode: loan.branchCode,
          });
          account.currentBalance = newBalance;
          await account.save();
          // Record metrics for collateral cash deposited into savings
          try {
            await recordMany([
              {
                metric: 'collateralCashDeposited',
                value: collateralAmt,
                date: loan.disbursementDate || loan.updatedAt || new Date(),
                branchName: loan.branchName,
                branchCode: loan.branchCode,
                loanOfficerName: loan.loanOfficerName,
                currency: account.currency,
                loan: loan._id,
                group: loan.group,
                client: loan.client,
                extra: { autoDeposit: true },
              },
            ]);
          } catch (cmErr) {
            console.error('[Metrics:collateralDeposit] failed:', cmErr.message);
          }
        }
      }
    } catch (sErr) {
      console.error('[Savings:setLoanStatus] failed to ensure collateral savings:', sErr.message);
      // Do not fail the status change due to savings errors
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
      const role = (user && user.role ? String(user.role).trim().toLowerCase() : '');
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

// Search loans by individual (client) name or group name
// GET /api/loans/search?q=<name>&branchCode=<code>&branchName=<name>&type=individual|group
// Returns: { q, clients, groups, individualLoans, groupMemberLoans }
exports.searchLoansByName = async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (!raw) return res.status(400).json({ error: 'q is required' });

    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const { branchCode, branchName, type } = req.query;

    // Build base loan filter (branch + role guard)
    const loanFilter = {};
    if (branchCode) loanFilter.branchCode = branchCode;
    if (branchName) loanFilter.branchName = branchName;
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).trim().toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      loanFilter.$or = [
        { createdByEmail: user.email },
        { loanOfficerName: user.username },
      ];
      if (!branchCode) loanFilter.branchCode = user.branchCode;
    }

    // Clients by name
    const clientFilter = { memberName: regex };
    if (branchCode) clientFilter.branchCode = branchCode;
    if (branchName) clientFilter.branchName = branchName;
    if (restricted && user) {
      clientFilter.createdByEmail = user.email;
      if (!branchCode) clientFilter.branchCode = user.branchCode;
    }
    const clients = await Client.find(clientFilter).select('memberName branchName branchCode');
    const clientIds = clients.map(c => c._id);

    // Groups by name
    const groupFilter = { groupName: regex };
    if (branchCode) groupFilter.branchCode = branchCode;
    if (branchName) groupFilter.branchName = branchName;
    if (restricted && user) {
      groupFilter.createdByEmail = user.email;
      if (!branchCode) groupFilter.branchCode = user.branchCode;
    }
    const groups = await Group.find(groupFilter).select('groupName branchName branchCode');
    const groupIds = groups.map(g => g._id);

    let individualLoans = [];
    let groupMemberLoans = [];

    if (!type || String(type).toLowerCase() === 'individual') {
      if (clientIds.length) {
        individualLoans = await Loan.find({
          ...loanFilter,
          loanType: { $ne: 'group' },
          client: { $in: clientIds },
        }).populate('client group').sort({ createdAt: -1 });
      }
    }

    if (!type || String(type).toLowerCase() === 'group') {
      if (groupIds.length) {
        groupMemberLoans = await Loan.find({
          ...loanFilter,
          loanType: 'individual',
          group: { $in: groupIds },
        }).populate('client group').sort({ createdAt: -1 });
      }
    }

    res.json({ q: raw, clients, groups, individualLoans, groupMemberLoans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
