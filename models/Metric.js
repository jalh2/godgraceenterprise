const mongoose = require('mongoose');

const metricSchema = new mongoose.Schema(
  {
    // Name of the metric, e.g. 'loanAmountDistributed', 'waitingToBeCollected',
    // 'overdue', 'totalCollateral', 'interestCollected', 'totalCollectionsCollected',
    // 'totalFormFees', 'totalInspectionFees', 'lostDueBookFee'
    metric: { type: String, required: true, index: true },

    // Numeric value of the metric (positive to increment, negative to decrement)
    value: { type: Number, required: true },

    // Date of the metric event (original) and normalized day key (midnight)
    date: { type: Date, default: Date.now },
    day: { type: Date, required: true },

    // Categorization
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
    loanOfficerName: { type: String },

    // Currency for amounts
    currency: { type: String, enum: ['USD', 'LRD'], required: true },

    // Optional relations
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },

    // Any additional small payload
    extra: { type: Object },
  },
  { timestamps: true }
);

function normalizeDay(d) {
  const dt = d ? new Date(d) : new Date();
  dt.setHours(0, 0, 0, 0);
  return dt;
}

metricSchema.pre('validate', function (next) {
  if (!this.day) {
    this.day = normalizeDay(this.date || new Date());
  } else {
    this.day = normalizeDay(this.day);
  }
  next();
});

// Common indexes for aggregations
metricSchema.index({ metric: 1, day: 1 });
metricSchema.index({ branchCode: 1, day: 1 });
metricSchema.index({ loanOfficerName: 1, day: 1 });
metricSchema.index({ currency: 1, day: 1 });

module.exports = mongoose.model('Metric', metricSchema);
