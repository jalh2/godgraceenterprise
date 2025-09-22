const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema(
  {
    communityName: { type: String, required: true, trim: true },
    communityCode: { type: String, required: true, unique: true, trim: true },
    location: { type: String, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ['Active', 'Inactive', 'Pending'], default: 'Active' },
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true, index: true },
    createdByEmail: { type: String, index: true },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Community', communitySchema);
