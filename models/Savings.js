const mongoose = require('mongoose');

const savingsTransactionSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  savingAmount: { type: Number, default: 0 },
  withdrawalAmount: { type: Number, default: 0 },
  balance: { type: Number, required: true },
  currency: { type: String, required: true, enum: ['USD', 'LRD'] },
  tellerSignature: { type: String }, // Base64
  managerSignature: { type: String }, // Base64
  branchName: { type: String, required: true },
  branchCode: { type: String, required: true },
});

const savingsAccountSchema = new mongoose.Schema(
  {
    // When accountType === 'individual': require client; group is optional (used for filtering/association)
    // When accountType === 'group': require group; client must be null/undefined
    accountType: { type: String, enum: ['individual', 'group'], default: 'individual', index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
    loanCycle: { type: Number, default: 1 },
    currentBalance: { type: Number, default: 0 },
    currency: { type: String, required: true, enum: ['USD', 'LRD'], default: 'LRD' },
    transactions: [savingsTransactionSchema],
  },
  { timestamps: true }
);

// Ensure uniqueness within type
// One savings per client for individual accounts
savingsAccountSchema.index(
  { client: 1 },
  { unique: true, partialFilterExpression: { accountType: 'individual', client: { $type: 'objectId' } } }
);
// One savings per group for group accounts
savingsAccountSchema.index(
  { group: 1 },
  { unique: true, partialFilterExpression: { accountType: 'group', group: { $type: 'objectId' } } }
);

module.exports = mongoose.model('SavingsAccount', savingsAccountSchema);
