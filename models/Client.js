const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    passBookNumber: { type: String, unique: true, sparse: true },
    branchName: { type: String },
    branchCode: { type: String },
    groupName: { type: String},
    groupCode: { type: String},
    createdByEmail: { type: String, index: true },
    memberName: { type: String },
    picture: { type: String }, // Base64 image data (you can store as Data URI or raw base64)
    memberAge: { type: Number },
    guardianName: { type: String },
    guarantorName: { type: String },
    communityAddress: { type: String },
    phoneNumber: { type: String },
    memberNumber: { type: String },
    admissionDate: { type: Date },
    passBookIssuedDate: { type: Date },
    nationalId: { type: String },
    memberSignature: { type: String }, // Base64
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Client', clientSchema);

