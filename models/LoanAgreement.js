const mongoose = require('mongoose');

const bondspersonSchema = new mongoose.Schema(
  {
    name: { type: String },
    sex: { type: String, enum: ['Male', 'Female', ''] },
    address: { type: String },
    occupation: { type: String },
  },
  { _id: false }
);

const signaturePartySchema = new mongoose.Schema(
  {
    name: { type: String },
    signature: { type: String }, // Base64 or plain string
    signatureDate: { type: Date },
    contacts: { type: String },
  },
  { _id: false }
);

const witnessSchema = new mongoose.Schema(
  {
    name: { type: String },
    contacts: { type: String },
  },
  { _id: false }
);

const creditorInfoSchema = new mongoose.Schema(
  {
    nameOfCreditor: { type: String },
    sex: { type: String, enum: ['Male', 'Female', ''] },
    contacts: { type: String },
    typeOfBusinessOrJob: { type: String },
    presentAddress: { type: String },
    businessAddress: { type: String },
    dateOfBirth: { type: Date },
    placeOfBirth: { type: String },
    numberOfChildren: { type: Number },
  },
  { _id: false }
);

const relatedContactsSchema = new mongoose.Schema(
  {
    husbandWifeName: { type: String },
    fatherMotherName: { type: String },
    partnerName: { type: String },
    familyPartnerContacts: { type: String },
  },
  { _id: false }
);

const loanAgreementSchema = new mongoose.Schema(
  {
    // Relation
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, unique: true, index: true },

    // Optional denormalized context for convenience/filtering
    branchName: { type: String },
    branchCode: { type: String },
    loanOfficerName: { type: String },
    currency: { type: String, enum: ['USD', 'LRD'] },

    // Page 1: Loan Information
    formNumber: { type: String }, // Form #
    dateOfCredit: { type: Date }, // Date of Credit
    cashAmountCredited: { type: Number }, // Cash Amount Credited
    amountInWords: { type: String }, // Amount in Words
    purposeOfLoan: { type: String }, // Purpose of the loan
    interestDeductedOrAdded: { type: Number },
    totalAmountToBePaid: { type: Number },

    // Creditor's Personal Information
    creditorInfo: creditorInfoSchema,

    // Related Contacts
    relatedContacts: relatedContactsSchema,

    // Collateral (free-text list per provided spec)
    collateralItemsText: { type: String },

    // Page 2: Bondsperson & Witness Information
    bondsperson1: bondspersonSchema,
    bondsperson2: bondspersonSchema,

    // Signatures & Affirmations
    signatureSection: new mongoose.Schema(
      {
        creditor: signaturePartySchema,
        bondsperson1: signaturePartySchema,
        bondsperson2: signaturePartySchema,
      },
      { _id: false }
    ),

    // Witnesses
    witnesses: [witnessSchema],

    // Official Approvals
    attestedBy: { type: String },
    approvedBy: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LoanAgreement', loanAgreementSchema);
