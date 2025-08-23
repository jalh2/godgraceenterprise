const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    groupName: { type: String, required: true, trim: true },
    groupCode: { type: String, required: true, unique: true },
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
    clients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
    loanOfficer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    meetingDay: { type: String },
    meetingTime: { type: String },
    status: { type: String, enum: ['Active', 'Inactive', 'Pending'], default: 'Pending' },
    totalLoans: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

groupSchema.virtual('memberCount').get(function () {
  return this.clients ? this.clients.length : 0;
});

module.exports = mongoose.model('Group', groupSchema);
