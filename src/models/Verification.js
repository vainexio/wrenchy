import mongoose from 'mongoose';

const verificationLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    userTag: { type: String },
    roleId: { type: String },
  },
  { timestamps: true },
);

export const VerificationLog = mongoose.model('VerificationLog', verificationLogSchema);
