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
    // Bloxlink verification: members holding this role whose nickname is "Display (@username)" are linked to that
    // Roblox account (roblox/verified.js). null = off: nobody is linked. (channelId / messageId / content / button* /
    // gameUrl / nickname*: the old in-game link panel and rename, unused since 2026-10-25)
    verifiedRoleId: { type: String, default: null },
    nicknameEnabled: { type: Boolean, default: true },
    nicknameFormat: { type: String, default: '{display} (@{username})' },
    bindings: { type: [robloxBindingSchema], default: [] },
  },
  { _id: false },
);

// Team activity (dashboard Team tab, /inactive): who counts as a tester or staff, by their Roblox group roles and
// their Discord roles, and how long without playing or chatting makes them inactive.
const teamGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    robloxRoleIds: { type: [Number], default: [] },
    discordRoleIds: { type: [String], default: [] },
  },
  { _id: false },
);

// (Piyesa Studios' roles as of 2026-10-25; the dashboard edits them)
const DEFAULT_TEAM_GROUPS = [
  { name: 'Testers', robloxRoleIds: [899226015], discordRoleIds: ['1561971641225973780'] },
  {
    name: 'Staff',
    // DC Moderator, Game Moderator, Baguhang Tanod, Tanod, Beteranong Tanod, Kagawad, Kapitan, Foreman, Mekaniko
    robloxRoleIds: [894162033, 893636029, 893364008, 871369028, 893598027, 878435067, 878363074, 869367039, 866334009],
    discordRoleIds: [
      '1556161267012603994', // Discord Moderator
      '1554369481231310858', // Game Moderator
      '1560160891746394112', // Baguhang Tanod
      '1560598634750550097', // Tanod
      '1560542090876948532', // Beteranong Tanod
      '1560547252471201792', // Kagawad
      '1556161118483783741', // Kapitan
      '1555103499644313660', // Foreman
      '1555246358947045546', // Mekaniko
    ],
  },
];

const teamSchema = new mongoose.Schema(
  {
    groups: { type: [teamGroupSchema], default: () => DEFAULT_TEAM_GROUPS },
    inactiveDays: { type: Number, default: 7 },
    discordSince: { type: Date, default: null }, // (when the bot began counting messages here)
    scannedAt: { type: Date, default: null }, // (the last history scan)
  },
  { _id: false },
);

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    verification: { type: verificationSchema, default: () => ({}) },
    reactionRoles: { type: reactionRolesSchema, default: () => ({}) },
    roblox: { type: robloxSchema, default: () => ({}) },
    team: { type: teamSchema, default: () => ({}) },
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
