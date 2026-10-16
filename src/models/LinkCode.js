import mongoose from 'mongoose';

const linkCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discordId: { type: String, required: true, index: true },
  guildId: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 }, // MongoDB deletes it once it expires
});

export const LinkCode = mongoose.model('LinkCode', linkCodeSchema);
