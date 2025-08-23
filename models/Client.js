const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    passBookNumber: { type: String, required: true, unique: true },
    branchName: { type: String, required: true },
    branchCode: { type: String, required: true },
    groupName: { type: String},
    groupCode: { type: String},
    memberName: { type: String, required: true },
    picture: { type: String }, // Base64 image data (you can store as Data URI or raw base64)
    memberAge: { type: Number, required: true },
    guardianName: { type: String, required: true },
    memberNumber: { type: String, required: true },
    admissionDate: { type: Date, required: true },
    passBookIssuedDate: { type: Date, required: true },
    nationalId: { type: String, required: true },
    memberSignature: { type: String }, // Base64
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Client', clientSchema);
