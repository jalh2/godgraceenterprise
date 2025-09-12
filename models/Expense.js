const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  // Basic expense information
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, enum: ['USD', 'LRD'], default: 'LRD' },
  category: {
    type: String,
    required: true,
    enum: [
      'operational', 'salary', 'rent', 'utilities', 'transport',
      'office_supplies', 'marketing', 'training', 'maintenance',
      'insurance', 'loan_loss_provision', 'other'
    ]
  },

  // Branch and location information
  branchName: { type: String, required: true },
  branchCode: { type: String, required: true },

  // Date and timing
  expenseDate: { type: Date, required: true, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  // Payment information
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'check', 'mobile_money', 'other'],
    default: 'cash'
  },

  // Authorization and approval
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'paid'],
    default: 'pending'
  },

  // Additional fields for tracking
  notes: { type: String },
  attachments: [{ type: String }], // Base64 encoded images/documents

  // For recurring expenses
  isRecurring: { type: Boolean, default: false },
  recurringFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
  },
  nextDueDate: { type: Date }
}, {
  timestamps: true
});

// Indexes for better query performance
expenseSchema.index({ branchCode: 1, expenseDate: -1 });
expenseSchema.index({ category: 1, expenseDate: -1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ expenseDate: -1 });

// Virtual for formatted amount
expenseSchema.virtual('formattedAmount').get(function() {
  return `${this.currency} ${this.amount.toLocaleString()}`;
});

// Pre-save middleware to update the updatedAt field
expenseSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Expense', expenseSchema);
