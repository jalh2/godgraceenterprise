const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    passwordSalt: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['admin', 'manager', 'branch head', 'staff', 'field agent', 'loan officer'],
      default: 'staff',
    },
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
