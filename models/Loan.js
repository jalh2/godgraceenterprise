const mongoose = require('mongoose');

const signatorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    signature: { type: String }, // Base64
    cellphoneNumber: { type: String },
    photo: { type: String }, // Base64 image for guarantor/bondsperson/community member
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
    createdByEmail: { type: String, index: true },
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

    // Payment plan and derived fee fields
    paymentPlan: { type: String, enum: ['weekly', 'bi-weekly', 'monthly'] },
    processingFeePercent: { type: Number }, // group: 3%, individual: 4%
    processingFeeAmount: { type: Number, default: 0 },
    formFeeAmount: { type: Number, default: 0 }, // LRD 200 for group; LRD 500 new / 400 returning for individual
    inspectionFeeAmount: { type: Number, default: 0 },
    collateralCashPercent: { type: Number }, // default 8%
    collateralCashAmount: { type: Number, default: 0 },
    netDisbursedAmount: { type: Number, default: 0 },
    isReturningClient: { type: Boolean, default: false },

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

    // Additional attachments and references
    loanPhoto: { type: String }, // Base64 image for loan form photo (optional)
    communityMemberInfo: signatorySchema, // For individual loan reference
    spouseName: { type: String }, // For individual loans if applicable
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
    // For group-member individual loans, guarantors are optional.
    // Only enforce 2 guarantors when the loan is not associated with a group.
    if (!this.group) {
      if (!this.guarantors || this.guarantors.length < 2) {
        this.invalidate('guarantors', 'Two guarantors are required for individual loans');
      }
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

  // Defaults for payment plan and fee-related fields
  // Payment plan must be provided for group/individual loans per new requirements
  if ((this.loanType === 'group' || this.loanType === 'individual') && !this.paymentPlan) {
    this.invalidate('paymentPlan', 'paymentPlan is required for group and individual loans');
  }

  // Default processing fee percent
  if (this.processingFeePercent == null) {
    if (this.loanType === 'group') this.processingFeePercent = 3;
    if (this.loanType === 'individual') this.processingFeePercent = this.group ? 3 : 4;
  }

  // Default collateral cash percent
  if (this.collateralCashPercent == null && (this.loanType === 'group' || this.loanType === 'individual')) {
    this.collateralCashPercent = 8;
  }

  // Default form fee amount if not provided
  if ((this.loanType === 'group' || this.loanType === 'individual') && (this.formFeeAmount == null)) {
    if (this.loanType === 'group') {
      // Form fee LRD 200 for group loans when currency is LRD
      this.formFeeAmount = this.currency === 'LRD' ? 200 : 0;
    } else if (this.loanType === 'individual') {
      // If linked to group, use group form fee; otherwise individual new/returning
      if (this.group) {
        this.formFeeAmount = this.currency === 'LRD' ? 200 : 0;
      } else {
        const returning = !!this.isReturningClient;
        this.formFeeAmount = this.currency === 'LRD' ? (returning ? 400 : 500) : 0;
      }
    }
  }

  // Compute derived amounts
  const amt = Number(this.loanAmount || 0);
  const procPct = Number(this.processingFeePercent || 0);
  const procAmt = Number((amt * (procPct / 100)).toFixed(2));
  this.processingFeeAmount = isNaN(procAmt) ? 0 : procAmt;

  const collateralPct = Number(this.collateralCashPercent || 0);
  const collateralAmt = Number((amt * (collateralPct / 100)).toFixed(2));
  this.collateralCashAmount = isNaN(collateralAmt) ? 0 : collateralAmt;

  const inspection = Number(this.inspectionFeeAmount || 0);
  const formFee = Number(this.formFeeAmount || 0);
  const net = Number((amt - (this.processingFeeAmount || 0) - formFee - inspection).toFixed(2));
  this.netDisbursedAmount = isNaN(net) ? 0 : net;

  next();
});

module.exports = mongoose.model('Loan', loanSchema);
