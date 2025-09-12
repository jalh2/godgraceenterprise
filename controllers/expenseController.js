const Expense = require('../models/Expense');
const { recordMetric } = require('../utils/metrics');

// Build common filter from query
function buildFilter(query) {
  const { branchCode, category, status, startDate, endDate, currency } = query || {};
  const filter = {};
  if (branchCode) filter.branchCode = branchCode;
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (currency) filter.currency = currency;
  if (startDate || endDate) {
    filter.expenseDate = {};
    if (startDate) filter.expenseDate.$gte = new Date(startDate);
    if (endDate) filter.expenseDate.$lte = new Date(endDate);
  }
  return filter;
}

// POST /api/expenses
exports.createExpense = async (req, res) => {
  try {
    const user = req.userDoc || {};
    const branchName = req.body.branchName || user.branchName || user.branch || '';
    const branchCode = req.body.branchCode || user.branchCode || '';
    const currency = req.body.currency || 'LRD';

    if (!user || !user._id) {
      // We require an identified user so recordedBy is set
      return res.status(401).json({ message: 'Authentication required via x-user-email header' });
    }

    const expense = new Expense({
      ...req.body,
      branchName,
      branchCode,
      currency,
      expenseDate: req.body.expenseDate ? new Date(req.body.expenseDate) : new Date(),
      recordedBy: user._id,
    });

    await expense.save();
    await expense.populate('recordedBy approvedBy', 'username email');

    // Record metrics (soft-fail)
    try {
      const amount = Number(expense.amount || 0);
      if (Number.isFinite(amount) && amount !== 0) {
        await recordMetric({
          metric: 'expenses',
          value: amount,
          date: expense.expenseDate || new Date(),
          branchName: branchName,
          branchCode: branchCode,
          loanOfficerName: user.username || '',
          currency: expense.currency || 'LRD',
          extra: { updateSource: 'expense', description: expense.description, category: expense.category },
        });
      }
    } catch (e) {
      console.error('[METRICS] expense record failed', e.message || e);
    }

    res.status(201).json(expense);
  } catch (error) {
    console.error(error.message);
    res.status(400).json({ message: 'Error creating expense', error: error.message });
  }
};

// GET /api/expenses
exports.getAllExpenses = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const filter = buildFilter(req.query);

    const [expenses, total] = await Promise.all([
      Expense.find(filter)
        .populate('recordedBy approvedBy', 'username email')
        .sort({ expenseDate: -1 })
        .limit(Number(limit) * 1)
        .skip((Number(page) - 1) * Number(limit)),
      Expense.countDocuments(filter),
    ]);

    res.json({
      expenses,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Error fetching expenses', error: error.message });
  }
};

// GET /api/expenses/:id
exports.getExpenseById = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id)
      .populate('recordedBy approvedBy', 'username email');
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json(expense);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Error fetching expense', error: error.message });
  }
};

// PUT /api/expenses/:id
exports.updateExpense = async (req, res) => {
  try {
    const existing = await Expense.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Expense not found' });

    const oldAmount = Number(existing.amount || 0);

    const updateFields = { ...req.body, updatedAt: Date.now() };
    if (updateFields.expenseDate) updateFields.expenseDate = new Date(updateFields.expenseDate);

    const updated = await Expense.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    ).populate('recordedBy approvedBy', 'username email');

    // Record delta metric if amount changed
    try {
      const newAmount = Number(updated.amount || 0);
      const delta = newAmount - oldAmount;
      if (delta) {
        await recordMetric({
          metric: 'expenses',
          value: delta,
          date: updated.expenseDate || new Date(),
          branchName: updated.branchName,
          branchCode: updated.branchCode,
          loanOfficerName: (req.userDoc && req.userDoc.username) || '',
          currency: updated.currency || 'LRD',
          extra: { updateSource: 'expenseUpdate', id: String(updated._id) },
        });
      }
    } catch (e) {
      console.error('[METRICS] expense update delta failed', e.message || e);
    }

    res.json(updated);
  } catch (error) {
    console.error(error.message);
    res.status(400).json({ message: 'Error updating expense', error: error.message });
  }
};

// DELETE /api/expenses/:id
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });

    try {
      const amount = Number(expense.amount || 0);
      if (amount) {
        await recordMetric({
          metric: 'expenses',
          value: -1 * amount,
          date: expense.expenseDate || new Date(),
          branchName: expense.branchName,
          branchCode: expense.branchCode,
          loanOfficerName: (req.userDoc && req.userDoc.username) || '',
          currency: expense.currency || 'LRD',
          extra: { updateSource: 'expenseDelete', id: String(expense._id) },
        });
      }
    } catch (e) {
      console.error('[METRICS] expense delete delta failed', e.message || e);
    }

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Error deleting expense', error: error.message });
  }
};

// PATCH /api/expenses/:id/status
exports.updateExpenseStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = ['pending', 'approved', 'rejected', 'paid'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status value' });

    const updateData = { status, updatedAt: Date.now() };
    if (status === 'approved' && req.userDoc?._id) {
      updateData.approvedBy = req.userDoc._id;
    }

    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('recordedBy approvedBy', 'username email');

    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    res.json(expense);
  } catch (error) {
    console.error(error.message);
    res.status(400).json({ message: 'Error updating expense status', error: error.message });
  }
};

// GET /api/expenses/analytics
exports.getExpenseAnalytics = async (req, res) => {
  try {
    const { period = 'month', branchCode, startDate, endDate } = req.query || {};

    // Date range
    let dateFilter = {};
    const now = new Date();

    if (startDate && endDate) {
      dateFilter = { expenseDate: { $gte: new Date(startDate), $lte: new Date(endDate) } };
    } else {
      switch (period) {
        case 'day':
          dateFilter = {
            expenseDate: {
              $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
              $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
            },
          };
          break;
        case 'week': {
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          dateFilter = { expenseDate: { $gte: weekStart, $lt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) } };
          break;
        }
        case 'month':
          dateFilter = {
            expenseDate: {
              $gte: new Date(now.getFullYear(), now.getMonth(), 1),
              $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            },
          };
          break;
        case 'year':
          dateFilter = {
            expenseDate: {
              $gte: new Date(now.getFullYear(), 0, 1),
              $lt: new Date(now.getFullYear() + 1, 0, 1),
            },
          };
          break;
        default:
          break;
      }
    }

    const matchFilter = { ...dateFilter };
    if (branchCode) matchFilter.branchCode = branchCode;

    // Category breakdown
    const categoryBreakdown = await Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$category', totalAmount: { $sum: '$amount' }, count: { $sum: 1 }, currency: { $first: '$currency' } } },
      { $sort: { totalAmount: -1 } },
    ]);

    // Branch breakdown
    const branchBreakdown = await Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: { branchCode: '$branchCode', branchName: '$branchName' }, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { totalAmount: -1 } },
    ]);

    // Status breakdown
    const statusBreakdown = await Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$status', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Totals
    const totalExpenses = await Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Daily trend
    const dailyTrend = await Expense.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { year: { $year: '$expenseDate' }, month: { $month: '$expenseDate' }, day: { $dayOfMonth: '$expenseDate' } },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    res.json({
      period,
      dateRange: dateFilter,
      summary: { totalAmount: totalExpenses[0]?.totalAmount || 0, totalCount: totalExpenses[0]?.count || 0 },
      categoryBreakdown,
      branchBreakdown,
      statusBreakdown,
      dailyTrend,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Error fetching expense analytics', error: error.message });
  }
};
