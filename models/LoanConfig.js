const mongoose = require('mongoose');

// Inner config schema for a single loan type
const loanTypeConfigSchema = new mongoose.Schema(
  {
    processingFeePercent: { type: Number },
    collateralCashPercent: { type: Number },
    // For group loans (and individuals linked to a group) this is the flat LRD form fee
    formFeeAmountLRD: { type: Number },
    // For individual loans not linked to a group
    formFeeAmountLRDNew: { type: Number },
    formFeeAmountLRDReturning: { type: Number },
    // Optional default inspection fee for this loan type
    inspectionFeeDefault: { type: Number },
  },
  { _id: false }
);

const loanConfigSchema = new mongoose.Schema(
  {
    // Optional: per-branch overrides. If omitted, document is considered a global default
    branchCode: { type: String, index: true, unique: true, sparse: true },
    express: loanTypeConfigSchema,
    individual: loanTypeConfigSchema,
    group: loanTypeConfigSchema,
    updatedBy: { type: String }, // user email or username
  },
  { timestamps: true }
);

module.exports = mongoose.model('LoanConfig', loanConfigSchema);
