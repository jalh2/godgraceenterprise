const mongoose = require('mongoose');

const signatorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    signature: { type: String }, // Base64
    cellphoneNumber: { type: String },
  },
  { _id: false }
);

const collateralSchema = new mongoose.Schema(
  {
    itemName: { type: String },
    description: { type: String },
    estimatedValue: { type: Number },
  },
  { _id: false }
);

const loanCollectionSchema = new mongoose.Schema(
  {
    memberName: { type: String, required: true },
    loanAmount: { type: Number, required: true },
    weeklyAmount: { type: Number, required: true },
    fieldCollection: { type: Number, required: true },
    advancePayment: { type: Number, default: 0 },
    fieldBalance: { type: Number, required: true },
    currency: { type: String, required: true, enum: ['USD', 'LRD'] },
    collectionDate: { type: Date, default: Date.now },
  },
  { _id: false }
);

const loanSchema = new mongoose.Schema(
  {
    // Categorization
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
    loanType: { type: String, enum: ['express', 'group', 'individual'], required: true },

    // Relations
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    clients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }], // for group loan
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' }, // for individual/express

    // Promissory/Reference Fields (similar to doc)
    meetingTime: { type: String },
    meetingDay: { type: String },
    memberCode: { type: String },
    memberAddress: { type: String },
    loanAmountInWords: { type: String },
    loanDurationNumber: { type: Number },
    loanDurationUnit: { type: String, enum: ['days', 'weeks', 'months', 'years'], default: 'weeks' },
    purposeOfLoan: { type: String },
    businessType: { type: String },
    disbursementDate: { type: Date, default: Date.now },
    endingDate: { type: Date },
    previousLoanInfo: { type: String },
    memberOccupation: { type: String },
    weeklyInstallment: { type: Number },
    securityDeposit: { type: Number },
    memberAdmissionFee: { type: Number },
    rentingOrOwner: { type: String, enum: ['renting', 'owner'] },
    educationBackground: { type: String, enum: ['high school degree', 'vocational school', 'university degree'] },
    district: { type: String },
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Widowed'] },
    dependents: { type: Number },
    previousLoanSource: { type: String },

    // Loan Financials
    loanAmount: { type: Number, required: true },
    interestRate: { type: Number, required: true },
    currency: { type: String, required: true, enum: ['USD', 'LRD'], default: 'LRD' },
    status: { type: String, enum: ['pending', 'active', 'paid', 'defaulted'], default: 'pending' },

    // Collections
    loanOfficerName: { type: String, required: true },
    totalRealization: { type: Number, default: 0 },
    collections: [loanCollectionSchema],

    // Guarantors and Signatories
    guarantors: [signatorySchema], // for individual loans (require 2)
    guarantorInfo: signatorySchema,
    treasuryInfo: signatorySchema,
    secretaryInfo: signatorySchema,
    groupHeadInfo: signatorySchema,
    loanOfficerInfo: signatorySchema,
    branchManagerInfo: signatorySchema,

    // Express collateral
    collateralItem: collateralSchema,
  },
  { timestamps: true }
);

// Helpers
function addDuration(date, number, unit) {
  const d = new Date(date);
  const n = Number(number || 0);
  if (!n || !unit) return d;
  switch (unit) {
    case 'days':
      d.setDate(d.getDate() + n);
      break;
    case 'weeks':
      d.setDate(d.getDate() + n * 7);
      break;
    case 'months':
      d.setMonth(d.getMonth() + n);
      break;
    case 'years':
      d.setFullYear(d.getFullYear() + n);
      break;
    default:
      break;
  }
  return d;
}

loanSchema.pre('validate', function (next) {
  // Basic branch validation
  if (!this.branchName || !this.branchCode) {
    this.invalidate('branchName', 'branchName and branchCode are required');
  }

  // Type-specific rules
  if (this.loanType === 'express') {
    this.loanDurationNumber = 1;
    this.loanDurationUnit = 'months';
    if (!this.collateralItem || !this.collateralItem.itemName) {
      this.invalidate('collateralItem.itemName', 'Collateral itemName is required for express loans');
    }
  }

  if (this.loanType === 'individual') {
    if (!this.client) this.invalidate('client', 'Client is required for individual loans');
    if (!this.guarantors || this.guarantors.length < 2) {
      this.invalidate('guarantors', 'Two guarantors are required for individual loans');
    }
  }

  if (this.loanType === 'group') {
    if (!this.group) this.invalidate('group', 'Group is required for group loans');
    if (!this.clients || this.clients.length === 0) {
      this.invalidate('clients', 'At least one client is required for group loans');
    }
  }

  // Ending date auto-calc if missing
  if (!this.endingDate && this.disbursementDate && this.loanDurationNumber && this.loanDurationUnit) {
    this.endingDate = addDuration(this.disbursementDate, this.loanDurationNumber, this.loanDurationUnit);
  }

  next();
});

module.exports = mongoose.model('Loan', loanSchema);
