const Metric = require('../models/Metric');
const { recordMetric, recordMany, normalizeDay } = require('../utils/metrics');

function parseMetricsParam(q) {
  if (!q) return undefined;
  if (Array.isArray(q)) return q.filter(Boolean);
  return String(q)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildMatch(query) {
  const match = {};
  const metrics = parseMetricsParam(query.metrics);
  if (metrics && metrics.length) match.metric = { $in: metrics };
  if (query.branchName) match.branchName = query.branchName;
  if (query.branchCode) match.branchCode = query.branchCode;
  if (query.loanOfficerName) match.loanOfficerName = query.loanOfficerName;
  if (query.currency) match.currency = query.currency;
  if (query.loan) match.loan = query.loan;
  if (query.group) match.group = query.group;
  if (query.client) match.client = query.client;

  const from = query.dateFrom ? new Date(query.dateFrom) : null;
  const to = query.dateTo ? new Date(query.dateTo) : null;
  if (from || to) {
    match.day = {};
    if (from) match.day.$gte = normalizeDay(from);
    if (to) match.day.$lte = normalizeDay(to);
  }
  return match;
}

function buildGroupId(groupBy, splitFields) {
  const key = (groupBy || 'day').toLowerCase();
  const base = { metric: '$metric' };
  if (key === 'year') Object.assign(base, { year: { $year: '$day' } });
  else if (key === 'month') Object.assign(base, { year: { $year: '$day' }, month: { $month: '$day' } });
  else if (key === 'week') Object.assign(base, { year: { $isoWeekYear: '$day' }, week: { $isoWeek: '$day' } });
  else Object.assign(base, { day: '$day' }); // default day

  // Add split fields to group key
  (splitFields || []).forEach((f) => {
    base[f] = `$${f}`;
  });
  return base;
}

function parseSplitBy(q) {
  const allow = new Set(['branchName', 'branchCode', 'loanOfficerName', 'currency', 'loan', 'group', 'client']);
  if (!q) return [];
  const parts = Array.isArray(q)
    ? q.flatMap((s) => String(s).split(',')).map((s) => s.trim())
    : String(q).split(',').map((s) => s.trim());
  return parts.filter((p) => allow.has(p));
}

exports.createMetrics = async (req, res) => {
  try {
    const { entries } = req.body || {};
    if (Array.isArray(entries) && entries.length > 0) {
      const saved = await recordMany(entries);
      return res.status(201).json(saved);
    }
    const saved = await recordMetric(req.body || {});
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const match = buildMatch(req.query);
    const groupBy = (req.query.groupBy || 'day').toLowerCase();
    const splitFields = parseSplitBy(req.query.splitBy);
    const groupId = buildGroupId(groupBy, splitFields);

    const pipeline = [{ $match: match }, { $group: { _id: groupId, total: { $sum: '$value' } } }];

    // Project period label based on grouping
    if (groupBy === 'month') {
      pipeline.push({
        $project: {
          _id: 0,
          metric: '$_id.metric',
          period: {
            $concat: [
              { $toString: '$_id.year' },
              '-',
              { $cond: [{ $lt: ['$_id.month', 10] }, { $concat: ['0', { $toString: '$_id.month' }] }, { $toString: '$_id.month' }] },
            ],
          },
          value: '$total',
          // Split fields
          ...(splitFields.includes('branchName') ? { branchName: '$_id.branchName' } : {}),
          ...(splitFields.includes('branchCode') ? { branchCode: '$_id.branchCode' } : {}),
          ...(splitFields.includes('loanOfficerName') ? { loanOfficerName: '$_id.loanOfficerName' } : {}),
          ...(splitFields.includes('currency') ? { currency: '$_id.currency' } : {}),
          ...(splitFields.includes('loan') ? { loan: '$_id.loan' } : {}),
          ...(splitFields.includes('group') ? { group: '$_id.group' } : {}),
          ...(splitFields.includes('client') ? { client: '$_id.client' } : {}),
        },
      });
    } else if (groupBy === 'week') {
      pipeline.push({
        $project: {
          _id: 0,
          metric: '$_id.metric',
          period: {
            $concat: [
              { $toString: '$_id.year' },
              '-W',
              { $cond: [{ $lt: ['$_id.week', 10] }, { $concat: ['0', { $toString: '$_id.week' }] }, { $toString: '$_id.week' }] },
            ],
          },
          value: '$total',
          ...(splitFields.includes('branchName') ? { branchName: '$_id.branchName' } : {}),
          ...(splitFields.includes('branchCode') ? { branchCode: '$_id.branchCode' } : {}),
          ...(splitFields.includes('loanOfficerName') ? { loanOfficerName: '$_id.loanOfficerName' } : {}),
          ...(splitFields.includes('currency') ? { currency: '$_id.currency' } : {}),
          ...(splitFields.includes('loan') ? { loan: '$_id.loan' } : {}),
          ...(splitFields.includes('group') ? { group: '$_id.group' } : {}),
          ...(splitFields.includes('client') ? { client: '$_id.client' } : {}),
        },
      });
    } else if (groupBy === 'year') {
      pipeline.push({
        $project: {
          _id: 0,
          metric: '$_id.metric',
          period: { $toString: '$_id.year' },
          value: '$total',
          ...(splitFields.includes('branchName') ? { branchName: '$_id.branchName' } : {}),
          ...(splitFields.includes('branchCode') ? { branchCode: '$_id.branchCode' } : {}),
          ...(splitFields.includes('loanOfficerName') ? { loanOfficerName: '$_id.loanOfficerName' } : {}),
          ...(splitFields.includes('currency') ? { currency: '$_id.currency' } : {}),
          ...(splitFields.includes('loan') ? { loan: '$_id.loan' } : {}),
          ...(splitFields.includes('group') ? { group: '$_id.group' } : {}),
          ...(splitFields.includes('client') ? { client: '$_id.client' } : {}),
        },
      });
    } else {
      pipeline.push({
        $project: {
          _id: 0,
          metric: '$_id.metric',
          period: { $dateToString: { date: '$_id.day', format: '%Y-%m-%d' } },
          value: '$total',
          ...(splitFields.includes('branchName') ? { branchName: '$_id.branchName' } : {}),
          ...(splitFields.includes('branchCode') ? { branchCode: '$_id.branchCode' } : {}),
          ...(splitFields.includes('loanOfficerName') ? { loanOfficerName: '$_id.loanOfficerName' } : {}),
          ...(splitFields.includes('currency') ? { currency: '$_id.currency' } : {}),
          ...(splitFields.includes('loan') ? { loan: '$_id.loan' } : {}),
          ...(splitFields.includes('group') ? { group: '$_id.group' } : {}),
          ...(splitFields.includes('client') ? { client: '$_id.client' } : {}),
        },
      });
    }

    pipeline.push({ $sort: { metric: 1, period: 1 } });

    const results = await Metric.aggregate(pipeline);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Compute profit (income - expenses) with the same groupBy/splitBy options
exports.getProfit = async (req, res) => {
  try {
    const match = buildMatch(req.query);
    const groupBy = (req.query.groupBy || 'day').toLowerCase();
    const splitFields = parseSplitBy(req.query.splitBy);
    const groupId = buildGroupId(groupBy, splitFields);

    const incomeMetrics = ['interestCollected', 'totalFormFees', 'totalInspectionFees', 'totalProcessingFees', 'lostDueBookFee'];
    const expenseMetrics = ['expenses'];

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: groupId,
          income: { $sum: { $cond: [{ $in: ['$metric', incomeMetrics] }, '$value', 0] } },
          expenses: { $sum: { $cond: [{ $in: ['$metric', expenseMetrics] }, '$value', 0] } },
        },
      },
    ];

    function addSplitFieldsProjection() {
      return {
        ...(splitFields.includes('branchName') ? { branchName: '$_id.branchName' } : {}),
        ...(splitFields.includes('branchCode') ? { branchCode: '$_id.branchCode' } : {}),
        ...(splitFields.includes('loanOfficerName') ? { loanOfficerName: '$_id.loanOfficerName' } : {}),
        ...(splitFields.includes('currency') ? { currency: '$_id.currency' } : {}),
        ...(splitFields.includes('loan') ? { loan: '$_id.loan' } : {}),
        ...(splitFields.includes('group') ? { group: '$_id.group' } : {}),
        ...(splitFields.includes('client') ? { client: '$_id.client' } : {}),
      };
    }

    if (groupBy === 'month') {
      pipeline.push({
        $project: {
          _id: 0,
          period: {
            $concat: [
              { $toString: '$_id.year' },
              '-',
              { $cond: [{ $lt: ['$_id.month', 10] }, { $concat: ['0', { $toString: '$_id.month' }] }, { $toString: '$_id.month' }] },
            ],
          },
          income: '$income',
          expenses: '$expenses',
          profit: { $subtract: ['$income', '$expenses'] },
          ...addSplitFieldsProjection(),
        },
      });
    } else if (groupBy === 'week') {
      pipeline.push({
        $project: {
          _id: 0,
          period: {
            $concat: [
              { $toString: '$_id.year' },
              '-W',
              { $cond: [{ $lt: ['$_id.week', 10] }, { $concat: ['0', { $toString: '$_id.week' }] }, { $toString: '$_id.week' }] },
            ],
          },
          income: '$income',
          expenses: '$expenses',
          profit: { $subtract: ['$income', '$expenses'] },
          ...addSplitFieldsProjection(),
        },
      });
    } else if (groupBy === 'year') {
      pipeline.push({
        $project: {
          _id: 0,
          period: { $toString: '$_id.year' },
          income: '$income',
          expenses: '$expenses',
          profit: { $subtract: ['$income', '$expenses'] },
          ...addSplitFieldsProjection(),
        },
      });
    } else {
      pipeline.push({
        $project: {
          _id: 0,
          period: { $dateToString: { date: '$_id.day', format: '%Y-%m-%d' } },
          income: '$income',
          expenses: '$expenses',
          profit: { $subtract: ['$income', '$expenses'] },
          ...addSplitFieldsProjection(),
        },
      });
    }

    pipeline.push({ $sort: { period: 1 } });

    const results = await Metric.aggregate(pipeline);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
