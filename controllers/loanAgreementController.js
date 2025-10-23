const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const LoanAgreement = require('../models/LoanAgreement');
const Client = require('../models/Client');

function canAccessLoan(user, loan) {
  const role = (user && user.role ? String(user.role).toLowerCase() : '');
  const restricted = role === 'loan officer' || role === 'field agent';
  if (restricted && user) {
    const own = (loan.createdByEmail && loan.createdByEmail.toLowerCase() === String(user.email).toLowerCase()) || (loan.loanOfficerName === user.username);
    return !!own;
  }
  return true;
}

function mapAgreementFromLoan(loan) {
  if (!loan) return {};
  const creditor = loan.creditorInfo || {};
  const related = loan.relatedContacts || {};
  const sig = loan.signatureSection || {};
  const witnesses = Array.isArray(loan.witnesses) ? loan.witnesses.map(w => ({ name: w.name, contacts: w.contacts })) : [];
  const guarantors = Array.isArray(loan.guarantors) ? loan.guarantors : [];

  // Bondsperson details from guarantors 0 and 1 if present
  const bond1 = guarantors[0] || {};
  const bond2 = guarantors[1] || {};

  const presentAddress = creditor.homeAddress || creditor.presentAddress || '';

  // Prefer loan.dateOfCredit when present; otherwise fall back to disbursementDate
  const mappedDateOfCredit = loan.dateOfCredit || loan.disbursementDate || undefined;

  // Compute interest amount (total - principal) if available
  const principal = Number(loan.loanAmount || 0);
  let interestAmt = undefined;
  if (loan.totalAmountToBePaid != null) {
    interestAmt = Number((Number(loan.totalAmountToBePaid || 0) - principal).toFixed(2));
  } else if (loan.interestRate != null) {
    interestAmt = Number((principal * (Number(loan.interestRate || 0) / 100)).toFixed(2));
  }

  // Prefer free-text collateralItemsText; otherwise for express/modern forms, use collateralDetails.propertyGiven
  const mappedCollateralText = (loan.collateralItemsText != null && loan.collateralItemsText !== '')
    ? loan.collateralItemsText
    : ((loan.collateralDetails && loan.collateralDetails.propertyGiven) || undefined);

  return {
    loan: loan._id,
    branchName: loan.branchName,
    branchCode: loan.branchCode,
    loanOfficerName: loan.loanOfficerName,
    currency: loan.currency,

    formNumber: loan.formNumber,
    dateOfCredit: mappedDateOfCredit,
    cashAmountCredited: loan.cashAmountCredited,
    amountInWords: loan.loanAmountInWords,
    purposeOfLoan: loan.purposeOfLoan,
    interestDeductedOrAdded: loan.interestDeductedOrAdded != null ? loan.interestDeductedOrAdded : interestAmt,
    interestAdjustmentType: 'added',
    totalAmountToBePaid: loan.totalAmountToBePaid,

    creditorInfo: {
      nameOfCreditor: creditor.nameOfCreditor,
      sex: creditor.sex,
      contacts: creditor.contacts,
      typeOfBusinessOrJob: creditor.typeOfBusinessOrJob || loan.businessType,
      presentAddress: presentAddress,
      businessAddress: creditor.businessAddress,
      dateOfBirth: creditor.dateOfBirth,
      placeOfBirth: creditor.placeOfBirth,
      numberOfChildren: creditor.numberOfChildren,
    },

    relatedContacts: {
      husbandWifeName: related.husbandWifeName,
      fatherMotherName: related.fatherMotherName,
      partnerName: related.partnerName,
      familyPartnerContacts: related.familyPartnerContacts,
    },

    collateralItemsText: mappedCollateralText,
    collateralItemsLocation: (loan.collateralDetails && loan.collateralDetails.propertyLocation) || undefined,

    bondsperson1: {
      name: bond1.name,
      sex: bond1.sex,
      address: bond1.address,
      occupation: bond1.occupation,
    },
    bondsperson2: {
      name: bond2.name,
      sex: bond2.sex,
      address: bond2.address,
      occupation: bond2.occupation,
    },

    signatureSection: {
      creditor: {
        name: sig?.creditor?.name,
        signature: sig?.creditor?.signature,
        signatureDate: sig?.creditor?.signatureDate,
        contacts: sig?.creditor?.contacts,
      },
      bondsperson1: {
        name: sig?.bondsperson1?.name,
        signature: sig?.bondsperson1?.signature,
        signatureDate: sig?.bondsperson1?.signatureDate,
        contacts: sig?.bondsperson1?.contacts || bond1.cellphoneNumber,
      },
      bondsperson2: {
        name: sig?.bondsperson2?.name,
        signature: sig?.bondsperson2?.signature,
        signatureDate: sig?.bondsperson2?.signatureDate,
        contacts: sig?.bondsperson2?.contacts || bond2.cellphoneNumber,
      },
    },

    witnesses,

    attestedBy: loan.attestedBy,
    approvedBy: loan.approvedBy,
  };
}

// Export the mapper for reuse in other controllers
exports.mapAgreementFromLoan = mapAgreementFromLoan;

exports.getAgreementForLoan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid loan id' });
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (!canAccessLoan(req.userDoc, loan)) return res.status(403).json({ error: 'Forbidden' });

    const agreement = await LoanAgreement.findOne({ loan: loan._id });
    if (!agreement) return res.status(404).json({ error: 'Loan agreement not found' });
    res.json(agreement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.initAgreementForLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (!canAccessLoan(req.userDoc, loan)) return res.status(403).json({ error: 'Forbidden' });

    let existing = await LoanAgreement.findOne({ loan: loan._id });
    if (existing) return res.json(existing);

    const payload = mapAgreementFromLoan(loan);
    // Prefill name of creditor from linked client when available
    try {
      if (!payload.creditorInfo) payload.creditorInfo = {};
      if (!payload.creditorInfo.nameOfCreditor && loan.client) {
        const client = await Client.findById(loan.client).select('memberName');
        if (client && client.memberName) {
          payload.creditorInfo.nameOfCreditor = client.memberName;
        }
      }
    } catch (_) {}
    const created = await LoanAgreement.create(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
exports.updateAgreementForLoan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid loan id' });
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (!canAccessLoan(req.userDoc, loan)) return res.status(403).json({ error: 'Forbidden' });

    const allowedFields = [
      'formNumber', 'dateOfCredit', 'cashAmountCredited', 'amountInWords', 'purposeOfLoan', 'interestDeductedOrAdded', 'interestAdjustmentType', 'totalAmountToBePaid',
      'creditorInfo', 'relatedContacts', 'collateralItemsText', 'collateralItemsLocation', 'bondsperson1', 'bondsperson2', 'signatureSection', 'witnesses', 'attestedBy', 'approvedBy'
    ];
    const update = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) update[key] = req.body[key];
    }

    const agreement = await LoanAgreement.findOneAndUpdate(
      { loan: loan._id },
      update,
      { new: true, upsert: true }
    );
    res.json(agreement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
