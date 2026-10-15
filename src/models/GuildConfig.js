import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    roleId: { type: String, default: null },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    content: {
      type: String,
      default:
        '**Welcome to Talyer!**\nClick the button below to verify yourself and get access to the rest of the server.',
    },
    buttonLabel: { type: String, default: 'Verify' },
    buttonEmoji: { type: String, default: '🔧' },
    successMessage: { type: String, default: "You're verified! Welcome to the shop, Talyerista. 🔧" },
  },
  { _id: false },
);

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    verification: { type: verificationSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

export async function getGuildConfig(guildId) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}
