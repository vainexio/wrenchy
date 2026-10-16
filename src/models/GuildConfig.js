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

// Matched by Roblox group role ID (never rank: ranks can be reordered in the group without breaking anything).
const robloxBindingSchema = new mongoose.Schema(
  {
    robloxRoleId: { type: Number, required: true },
    robloxRoleName: { type: String, default: '' }, // (for display; the ID is what matches)
    discordRoleIds: { type: [String], default: [] },
  },
  { _id: false },
);

const robloxSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    content: {
      type: String,
      default:
        '**Staff: link your Roblox account**\nClick the button to get a code, then type it in game with `/link`. Your staff roles here follow your rank in the group.',
    },
    buttonLabel: { type: String, default: 'Link Roblox' },
    buttonEmoji: { type: String, default: '🔗' },
    gameUrl: { type: String, default: '' },
    linkedRoleId: { type: String, default: null },
    nicknameEnabled: { type: Boolean, default: true },
    nicknameFormat: { type: String, default: '{display} (@{username})' },
    bindings: { type: [robloxBindingSchema], default: [] },
  },
  { _id: false },
);

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    verification: { type: verificationSchema, default: () => ({}) },
    reactionRoles: { type: reactionRolesSchema, default: () => ({}) },
    roblox: { type: robloxSchema, default: () => ({}) },
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
