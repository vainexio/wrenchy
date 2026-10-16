import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    roleId: { type: String, default: null }, // main role; having it means "verified"
    extraRoleIds: { type: [String], default: [] }, // also given on verify, members can remove them later
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

const roleButtonSchema = new mongoose.Schema(
  {
    roleId: { type: String, required: true },
    label: { type: String, required: true },
    emoji: { type: String, default: '' },
  },
  { _id: false },
);

const reactionRolesSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    content: {
      type: String,
      default: '**Pick your roles!**\nClick a button to add a role. Click it again to remove it.',
    },
    addedMessage: { type: String, default: 'Added {role}.' },
    removedMessage: { type: String, default: 'Removed {role}.' },
    buttons: { type: [roleButtonSchema], default: [] },
  },
  { _id: false },
);

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    verification: { type: verificationSchema, default: () => ({}) },
    reactionRoles: { type: reactionRolesSchema, default: () => ({}) },
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
