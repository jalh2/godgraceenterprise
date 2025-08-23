const mongoose = require('mongoose');

const distributionSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    memberName: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['USD', 'LRD'], required: true },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Distribution', distributionSchema);
