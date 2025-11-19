const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Distribution = require('../models/Distribution');
const Metric = require('../models/Metric');
const { recordMany, computeInterestForLoan, collateralValueFromLoan } = require('./metrics');

async function recalculateAllMetrics() {

  console.log('[Metrics Recalc] Starting full recalculation...');
  
  // 1. Clear **loan-derived** metrics only (keep expenses, savings, and other manual metrics)
  const loanMetrics = [
    'loanAmountDistributed',
    'waitingToBeCollected',
    'overdue',
    'interestCollected',
    'totalCollectionsCollected',
    'totalCollateral',
    'collateralCashRequired',
    'totalFormFees',
    'totalInspectionFees',
    'totalProcessingFees',
    'collateralCashDeposited',
  ];
  await Metric.deleteMany({ metric: { $in: loanMetrics } });
  console.log('[Metrics Recalc] Cleared existing loan-derived metrics.');

  // 2. Fetch all loans (for loan-based and distribution-based metrics)
  const loans = await Loan.find({}).sort({ createdAt: 1 });
  console.log(`[Metrics Recalc] Found ${loans.length} loans to process.`);
  const loanById = new Map(loans.map((loan) => [String(loan._id), loan]));

  const BATCH_SIZE = 50; // Record metrics in batches to avoid memory issues if too large
  let eventsBuffer = [];

  async function flushBuffer() {
    if (eventsBuffer.length > 0) {
      await recordMany(eventsBuffer);
      eventsBuffer = [];
    }
  }

  for (const loan of loans) {
    const base = {
      branchName: loan.branchName,
      branchCode: loan.branchCode,
      loanOfficerName: loan.loanOfficerName,
      currency: loan.currency,
      loan: loan._id,
      group: loan.group,
      client: loan.client,
    };

    // A. Creation Metrics (Fees, Collateral)
    // Use createdAt for these events (close enough to original createLoan behavior)
    const creationDate = loan.disbursementDate || loan.createdAt || new Date();
    
    const collateral = collateralValueFromLoan(loan);
    if (collateral && collateral !== 0) {
      eventsBuffer.push({ ...base, metric: 'totalCollateral', value: collateral, date: creationDate, extra: { recalc: true, type: 'creation' } });
    }
    if (loan.collateralCashAmount) {
      eventsBuffer.push({ ...base, metric: 'collateralCashRequired', value: Number(loan.collateralCashAmount), date: creationDate, extra: { recalc: true, type: 'creation' } });
    }
    if (loan.formFeeAmount) {
      eventsBuffer.push({ ...base, metric: 'totalFormFees', value: Number(loan.formFeeAmount), date: creationDate, extra: { recalc: true, type: 'creation' } });
    }
    if (loan.inspectionFeeAmount) {
      eventsBuffer.push({ ...base, metric: 'totalInspectionFees', value: Number(loan.inspectionFeeAmount), date: creationDate, extra: { recalc: true, type: 'creation' } });
    }
    if (loan.processingFeeAmount) {
      eventsBuffer.push({ ...base, metric: 'totalProcessingFees', value: Number(loan.processingFeeAmount), date: creationDate, extra: { recalc: true, type: 'creation' } });
    }

    // B. Activation Metrics (Status = active)
    // If loan is active/paid/defaulted, it must have been activated.
    // Use disbursementDate if available, else updatedAt (approximation of activation time)
    if (['active', 'paid', 'defaulted'].includes(loan.status)) {
      const activationDate = loan.disbursementDate || loan.updatedAt || creationDate;
      
      // Interest
      const interest = computeInterestForLoan(loan);
      if (interest && !isNaN(interest)) {
        eventsBuffer.push({ ...base, metric: 'interestCollected', value: interest, date: activationDate, extra: { recalc: true, type: 'activation' } });
      }

      // Disbursement & Waiting (for non-group loans)
      if (loan.loanType !== 'group') {
        eventsBuffer.push({
          ...base,
          metric: 'loanAmountDistributed',
          value: Number(loan.netDisbursedAmount || loan.loanAmount || 0),
          date: activationDate,
          extra: { recalc: true, type: 'activation' }
        });
        eventsBuffer.push({
          ...base,
          metric: 'waitingToBeCollected',
          value: Number(loan.loanAmount || 0),
          date: activationDate,
          extra: { recalc: true, type: 'activation' }
        });
      }

      // Collateral Cash Deposited (if any)
      // Note: We don't check SavingsAccount here, we just assume if collateralCashAmount > 0 it was deposited upon activation
      // as per the controller logic.
      const collateralAmt = Number(loan.collateralCashAmount || 0);
      if (collateralAmt > 0 && loan.client) {
         eventsBuffer.push({
           ...base,
           metric: 'collateralCashDeposited',
           value: collateralAmt,
           date: activationDate,
           extra: { recalc: true, type: 'activation' }
         });
      }
    }

    // C. Collections
    if (loan.collections && loan.collections.length > 0) {
       loan.collections.forEach((col, idx) => {
         const collected = Number(col.fieldCollection || 0);
         const collectionDate = col.collectionDate || new Date();
         
         if (collected !== 0) {
           eventsBuffer.push({
             ...base,
             metric: 'totalCollectionsCollected',
             value: collected,
             date: collectionDate,
             extra: { recalc: true, type: 'collection', idx }
           });
           eventsBuffer.push({
             ...base,
             metric: 'waitingToBeCollected',
             value: -collected,
             date: collectionDate,
             extra: { recalc: true, type: 'collection', idx }
           });
         }

         // Overdue calculation (simplified based on controller logic)
         const weeklyAmount = Number(col.weeklyAmount || 0);
         const overdueVal = Math.max(weeklyAmount - collected, 0);
         if (overdueVal > 0) {
            eventsBuffer.push({
              ...base,
              metric: 'overdue',
              value: overdueVal,
              date: collectionDate,
              extra: { recalc: true, type: 'collection', idx }
            });
         }
       });
    }

    if (eventsBuffer.length >= BATCH_SIZE) {
      await flushBuffer();
    }
  }

  // D. Distributions – rebuild disbursement & waiting metrics from current records
  const distributions = await Distribution.find({}).sort({ date: 1 });
  console.log(`[Metrics Recalc] Processing ${distributions.length} distributions...`);
  for (const d of distributions) {
    const loan = loanById.get(String(d.loan));
    const amount = Number(d.amount || 0);
    if (!(amount > 0)) continue;
    const date = d.date || new Date();
    const base = {
      date,
      branchName: (loan && loan.branchName) || d.branchName,
      branchCode: (loan && loan.branchCode) || d.branchCode,
      loanOfficerName: loan ? loan.loanOfficerName : undefined,
      currency: (loan && loan.currency) || d.currency,
      loan: d.loan,
      group: (loan && loan.group) || d.group,
      client: loan ? loan.client : undefined,
      extra: { recalc: true, type: 'distribution', distribution: d._id },
    };
    eventsBuffer.push({ ...base, metric: 'loanAmountDistributed', value: amount });
    eventsBuffer.push({ ...base, metric: 'waitingToBeCollected', value: amount });
    if (eventsBuffer.length >= BATCH_SIZE) {
      await flushBuffer();
    }
  }

  await flushBuffer();
  console.log('[Metrics Recalc] Completed.');
  return { success: true, loans: loans.length, distributions: distributions.length };
}

module.exports = { recalculateAllMetrics };
