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

// The onboarding guide (the owner, 2026-10-31): DMed to people added to the team, one step at a time with a Done
// button that's checked: verify with Bloxlink (the Verified role), join the Roblox community (then they're ranked and
// their roles updated), read these channels... Steps they've already done are skipped.
const onboardingStepSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ['verify', 'group', 'channels', 'info'], default: 'info' },
    title: { type: String, required: true },
    text: { type: String, default: '' },
    channelIds: { type: [String], default: [] }, // (a 'channels' step: the channels to read)
    button: { type: String, default: 'Done' },
  },
  { _id: false },
);

const DEFAULT_ONBOARDING_STEPS = [
  {
    id: 'verify', kind: 'verify', title: 'Verify with Bloxlink', button: 'Done',
    text: 'Verify your Roblox account with Bloxlink in the server (it sets your nickname to your Roblox name). Press Done when you have the Verified role.',
  },
  {
    id: 'group', kind: 'group', title: 'Join the community', button: 'Done',
    text: 'Join our Roblox community: {groupLink}\nPress Done once you’re in, and I’ll give you your {team} rank.',
  },
  {
    id: 'channels', kind: 'channels', title: 'Read these channels', button: 'I’ve read them',
    text: 'Please read these before you start:',
  },
];

const onboardingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    intro: { type: String, default: 'Welcome to the {team} team, {user}! A few quick steps to get you set up.' },
    finish: { type: String, default: 'You’re all set. Welcome aboard! 🎉' },
    groupLink: { type: String, default: '' }, // ('' = the group's page on Roblox)
    fallbackChannelId: { type: String, default: null }, // (when their DMs are closed, the guide is posted here instead)
    steps: { type: [onboardingStepSchema], default: () => DEFAULT_ONBOARDING_STEPS },
  },
  { _id: false },
);

const teamSchema = new mongoose.Schema(
  {
    onboarding: { type: onboardingSchema, default: () => ({}) },
    groups: { type: [teamGroupSchema], default: () => DEFAULT_TEAM_GROUPS },
    inactiveDays: { type: Number, default: 7 },
    // (below these in the last 7 days = "Low activity", even when seen recently; 0 = off)
    minMessagesWeek: { type: Number, default: 10 },
    minVoiceWeek: { type: Number, default: 30 }, // (minutes in voice with others: either minimum keeps them active on Discord)
    minMinutesWeek: { type: Number, default: 60 },
    dailySince: { type: Date, default: null }, // (when the bot began counting per day)
    backfilledAt: { type: Date, default: null }, // (the one-time fill-in of the last 60 days of chat)
    discordSince: { type: Date, default: null }, // (when the bot began counting messages here)
    scannedAt: { type: Date, default: null }, // (the last history scan)
  },
  { _id: false },
);

// Tickets (the owner, 2026-10-30): types of ticket ("Content creator application", "Player report"...), each with its
// own category, staff roles and channel names ("cc-apps-{n}" -> cc-apps-0001), opened from panels posted in a channel.
const ticketQuestionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true }, // (a form field: up to 45 characters)
    placeholder: { type: String, default: '' },
    long: { type: Boolean, default: false }, // (a paragraph box rather than one line)
    required: { type: Boolean, default: true },
  },
  { _id: false },
);

const ticketTypeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // (stays the same when renamed: buttons and tickets point at it)
    name: { type: String, required: true }, // (the button's label)
    emoji: { type: String, default: '' },
    style: { type: String, enum: ['primary', 'secondary', 'success', 'danger'], default: 'primary' },
    description: { type: String, default: '' }, // (under it in a dropdown panel)
    categoryId: { type: String, default: null }, // (the Discord category its tickets open in)
    staffRoleIds: { type: [String], default: [] }, // (who sees and handles its tickets)
    namePattern: { type: String, default: 'ticket-{n}' },
    welcome: { type: String, default: 'Thanks for opening a ticket, {user}! Staff will be with you soon.' },
    questions: { type: [ticketQuestionSchema], default: [] }, // (asked in a form before it opens; up to 5)
    pingStaff: { type: Boolean, default: true },
    maxOpen: { type: Number, default: 1 }, // (open tickets of this type one member can have)
  },
  { _id: false },
);

const ticketPanelSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: 'Ticket panel' }, // (for the dashboard)
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    title: { type: String, default: 'Need help?' },
    description: { type: String, default: 'Pick what your ticket is about and a private channel opens with our staff.' },
    color: { type: String, default: '#F08C1A' },
    imageUrl: { type: String, default: '' }, // (a big picture under the message)
    thumbnailUrl: { type: String, default: '' }, // (a small one in the corner)
    footer: { type: String, default: '' },
    footerIconUrl: { type: String, default: '' },
    style: { type: String, enum: ['buttons', 'menu'], default: 'buttons' },
    placeholder: { type: String, default: 'Open a ticket…' }, // (a dropdown's prompt)
    typeIds: { type: [String], default: [] }, // (in the order they show)
  },
  { _id: false },
);

const ticketsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    transcriptChannelId: { type: String, default: null }, // (closed tickets' transcripts are posted here)
    dmTranscript: { type: Boolean, default: true }, // (and sent to the person who opened it)
    deleteOnClose: { type: Boolean, default: true }, // (closing deletes the channel 5 seconds later)
    closedCategoryId: { type: String, default: null }, // (with deleteOnClose off: closed tickets move here; null = they stay)
    types: { type: [ticketTypeSchema], default: [] },
    panels: { type: [ticketPanelSchema], default: [] },
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
    tickets: { type: ticketsSchema, default: () => ({}) },
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
