const mongoose = require('mongoose');
const LoanConfig = require('./LoanConfig');

const signatorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    signature: { type: String }, // Base64
    cellphoneNumber: { type: String },
    photo: { type: String }, // Base64 image for guarantor/bondsperson/community member
    // Additional identity fields for bondsperson/guarantor as per new form spec
    sex: { type: String, enum: ['Male', 'Female'] },
    address: { type: String },
    occupation: { type: String },
    monthlyIncome: { type: Number },
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

    // Loan form fields (Page 1: Creditor & Loan Details)
    formNumber: { type: String }, // Form #
    applicationDate: { type: String }, // Page 1: Date (string on form)
    cashAmountCredited: { type: Number }, // Cash Amount Credited
    interestDeductedOrAdded: { type: Number }, // Interest Deducted or Added
    totalAmountToBePaid: { type: Number }, // Total amount to be paid

    // Promissory/Reference Fields (similar to doc)
    meetingTime: { type: String },
    meetingDay: { type: String },
    memberCode: { type: String },
    memberAddress: { type: String },
    loanAmountInWords: { type: String },
    loanDurationNumber: { type: Number },
    loanDurationUnit: { type: String, enum: ['days', 'weeks', 'months', 'years'], default: 'weeks' },
    purposeOfLoan: { type: String }, // Page 1: Purpose of the Loan
    businessType: { type: String }, // Occupation/Type of Business (legacy)
    disbursementDate: { type: Date, default: Date.now },
    collectionStartDate: { type: Date },
    endingDate: { type: Date },
    previousLoanInfo: { type: String },
    memberOccupation: { type: String },
    weeklyInstallment: { type: Number },
    securityDeposit: { type: Number },
    memberAdmissionFee: { type: Number },
    rentingOrOwner: { type: String, enum: ['renting', 'owner'] },
    educationBackground: { type: String, enum: ['high school degree', 'vocational school', 'university degree'] },
    district: { type: String },
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Divorce', 'Widowed', 'Serious Relationship'] },
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
    // Free-text collateral list per form spec
    collateralItemsText: { type: String },

    // Additional attachments and references
    loanPhoto: { type: String }, // Base64 image for loan form photo (optional)
    communityMemberInfo: signatorySchema, // For individual loan reference
    spouseName: { type: String }, // For individual loans if applicable

    // Spouse Affirmation (Page 2)
    spouseAffirmation: {
      spouseName: { type: String },
      applicantNameForSpouseSection: { type: String },
      spouseSignature: { type: String }, // Base64 or string
      spouseSignatureDate: { type: Date },
      spouseContact: { type: String },
    },

    // Creditor's Personal Information snapshot at loan time
    creditorInfo: {
      nameOfCreditor: { type: String },
      sex: { type: String, enum: ['Male', 'Female'] },
      contacts: { type: String },
      typeOfBusinessOrJob: { type: String },
      presentAddress: { type: String }, // legacy alias
      homeAddress: { type: String }, // Page 1: Home Address
      businessAddress: { type: String },
      dateOfBirth: { type: Date },
      placeOfBirth: { type: String },
      numberOfChildren: { type: Number },
      totalEstimatedBusinessAmount: { type: Number }, // Page 1: Total Estimated Amount in the Business
    },

    // Applicant's Financial History (Page 1)
    financialHistory: {
      takenLoanBefore: { type: Boolean },
      previousLoanInstitutionName: { type: String },
      reasonLeftPreviousLoanEntity: { type: String },
      hasCurrentLoan: { type: Boolean },
      currentLoanInstitutionName: { type: String },
      isPartOfFinancialInstitution: { type: Boolean },
      financialInstitutionName: { type: String },
    },

    // Applicant Agreements (Page 2)
    applicantAgreements: {
      authorityContacts: { type: String },
      agreeInspection: { type: Boolean },
      reasonNoInspection: { type: String },
      agreePaymentReminders: { type: Boolean },
    },

    // Income & Expenses (Page 2)
    incomeAndExpenses: {
      businessOrJobIncome: {
        daily: { type: Number },
        weekly: { type: Number },
        monthly: { type: Number },
      },
      businessProfit: {
        daily: { type: Number },
        weekly: { type: Number },
        monthly: { type: Number },
      },
      dailyExpenditure: { type: Number },
    },

    // Collateral details (Page 2)
    collateralDetails: {
      propertyGiven: { type: String },
      propertyLocation: { type: String },
      propertyValue: { type: Number },
      repaymentPlanExplanation: { type: String },
    },

    // Related Contacts per form spec
    relatedContacts: {
      husbandWifeName: { type: String },
      fatherMotherName: { type: String },
      partnerName: { type: String },
      familyPartnerContacts: { type: String },
    },

    // Signatures & Affirmations section
    signatureSection: {
      creditor: {
        name: { type: String },
        signature: { type: String }, // Base64 or string
        signatureDate: { type: Date },
        contacts: { type: String },
      },
      bondsperson1: {
        name: { type: String },
        signature: { type: String },
        signatureDate: { type: Date },
        contacts: { type: String },
      },
      bondsperson2: {
        name: { type: String },
        signature: { type: String },
        signatureDate: { type: Date },
        contacts: { type: String },
      },
    },

    // Witnesses (3 entries typical)
    witnesses: [
      new mongoose.Schema(
        {
          name: { type: String },
          contacts: { type: String },
        },
        { _id: false }
      ),
    ],

    // Official Approvals (legacy)
    attestedBy: { type: String }, // e.g., Manager's Name
    approvedBy: { type: String }, // e.g., Approver's Name/Title

    // Official Use Only (Page 3)
    officialUse: {
      dateOfInspection: { type: Date },
      dateToReceiveLoan: { type: Date },
      approvedAmountToBeGiven: { type: Number },
      loanOfficerSignature: { type: String }, // Base64 or string
      loanSupervisorApprovalSignature: { type: String }, // Base64 or string
    },
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

loanSchema.pre('validate', async function (next) {
  // Basic branch validation
  if (!this.branchName || !this.branchCode) {
    this.invalidate('branchName', 'branchName and branchCode are required');
  }

  // Type-specific rules
  if (this.loanType === 'express') {
    this.loanDurationNumber = 1;
    this.loanDurationUnit = 'months';
    // No longer require collateralItem; express form now captures collateralDetails
    // Optionally, ensure at least some collateral info is present (soft check only)
    // if (!this.collateralDetails || !this.collateralDetails.propertyGiven) {
    //   this.invalidate('collateralDetails.propertyGiven', 'Property given as collateral is required for express loans');
    // }
  }

  if (this.loanType === 'individual') {
    if (!this.client) this.invalidate('client', 'Client is required for individual loans');
    // For group-member individual loans, guarantors are optional.
    // Only enforce 2 guarantors when the loan is not associated with a group.
    if (!this.group) {
      if (!this.guarantors || this.guarantors.length < 1) {
        this.invalidate('guarantors', 'At least one guarantor is required for individual loans');
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

  // dateOfCredit removed from Loan form; no defaulting here

  // Fetch dynamic loan configuration (per-branch or global) to derive defaults
  let configDoc = null;
  try {
    if (this.branchCode) {
      configDoc = await LoanConfig.findOne({ branchCode: this.branchCode });
    }
    if (!configDoc) {
      configDoc = await LoanConfig.findOne({ branchCode: { $exists: false } });
    }
  } catch (e) {
    // continue with built-in fallbacks
  }

  const typeKey = String(this.loanType || '').toLowerCase();
  const typeCfg = (configDoc && configDoc[typeKey]) || {};

  // Defaults for payment plan and fee-related fields
  // Payment plan must be provided for group/individual loans per new requirements
  if ((this.loanType === 'group' || this.loanType === 'individual') && !this.paymentPlan) {
    this.invalidate('paymentPlan', 'paymentPlan is required for group and individual loans');
  }

  // Default processing fee percent
  if (this.processingFeePercent == null) {
    const fallback = (this.loanType === 'group') ? 3 : (this.loanType === 'individual' ? (this.group ? 3 : 4) : 0);
    this.processingFeePercent = Number(typeCfg.processingFeePercent ?? fallback);
  }

  // Default collateral cash percent
  if (this.collateralCashPercent == null && (this.loanType === 'group' || this.loanType === 'individual')) {
    const fallback = (this.loanType === 'individual') ? 10 : 8; // individual collateral default 10%
    this.collateralCashPercent = Number(typeCfg.collateralCashPercent ?? fallback);
  }

  // Default form fee amount if not provided
  if ((this.loanType === 'group' || this.loanType === 'individual') && (this.formFeeAmount == null)) {
    if (this.currency !== 'LRD') {
      this.formFeeAmount = 0;
    } else if (this.loanType === 'group' || this.group) {
      const grpCfgAmt = configDoc && configDoc.group && configDoc.group.formFeeAmountLRD;
      this.formFeeAmount = Number(grpCfgAmt ?? 200);
    } else if (this.loanType === 'individual') {
      const returning = !!this.isReturningClient;
      const indNew = configDoc && configDoc.individual && configDoc.individual.formFeeAmountLRDNew;
      const indRet = configDoc && configDoc.individual && configDoc.individual.formFeeAmountLRDReturning;
      this.formFeeAmount = Number(returning ? (indRet ?? 400) : (indNew ?? 500));
    }
  }

  // Optional default inspection fee from config if not provided
  if (this.inspectionFeeAmount == null || this.inspectionFeeAmount === '') {
    if (typeCfg && typeCfg.inspectionFeeDefault != null) {
      this.inspectionFeeAmount = Number(typeCfg.inspectionFeeDefault);
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

  // Total amount to be paid default (principal + interest)
  if (this.totalAmountToBePaid == null) {
    const rate = Number(this.interestRate || 0);
    const total = Number((amt * (1 + (rate / 100))).toFixed(2));
    this.totalAmountToBePaid = isNaN(total) ? undefined : total;
  }

  // Cash amount credited defaults to net disbursed amount when not provided
  if (this.cashAmountCredited == null) {
    this.cashAmountCredited = this.netDisbursedAmount || 0;
  }

  next();
});

module.exports = mongoose.model('Loan', loanSchema);
