import mongoose from 'mongoose';

// When each group member last played, as the game reports it (POST /api/game/presence). One per Roblox account,
// whichever game they played (Mangingisda, Talyer).
const playerActivitySchema = new mongoose.Schema(
  {
    robloxId: { type: Number, required: true, unique: true },
    username: { type: String, required: true },
    displayName: { type: String },
    game: { type: String, default: '' }, // (the last game they were in)
    online: { type: Boolean, default: false },
    lastJoinAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null }, // (the last join, heartbeat or leave)
    sessions: { type: Number, default: 0 },
    minutes: { type: Number, default: 0 }, // (total time in game since tracking began)
  },
  { timestamps: true },
);

export const PlayerActivity = mongoose.model('PlayerActivity', playerActivitySchema);

// When each member last sent a message in a server. Only the time and channel: never the text.
const discordActivitySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    lastMessageAt: { type: Date, default: null },
    lastChannelId: { type: String, default: null },
    messages: { type: Number, default: 0 }, // (counted since tracking began; a history scan doesn't add to it)
    lastVoiceAt: { type: Date, default: null }, // (the last minute they were in a voice channel)
  },
  { timestamps: true },
);
discordActivitySchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const DiscordActivity = mongoose.model('DiscordActivity', discordActivitySchema);

// Per member per day (Manila time): how much they chatted, for the Team tab's activity numbers. One message a day keeps
// "last message" fresh but isn't taking part (the owner, 2026-10-30: "they can bypass activity by sending 1 useless
// message everyday"). Still never the text: the count, how many were replies, which channels, and minutes in voice.
// Kept 120 days.
const DAILY_KEEP_S = 120 * 86_400;
const discordDailySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    day: { type: String, required: true }, // ("2026-10-30")
    messages: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    channels: { type: [String], default: [] },
    voiceMinutes: { type: Number, default: 0 }, // (in a voice channel, AFK channel aside)
    voiceWithOthers: { type: Number, default: 0 }, // (of those, with someone else there and not deafened)
  },
  { timestamps: true },
);
discordDailySchema.index({ guildId: 1, userId: 1, day: 1 }, { unique: true });
discordDailySchema.index({ createdAt: 1 }, { expireAfterSeconds: DAILY_KEEP_S });

export const DiscordDaily = mongoose.model('DiscordDaily', discordDailySchema);

// Per player per day: minutes played and sessions started (the game's presence reports).
const playerDailySchema = new mongoose.Schema(
  {
    robloxId: { type: Number, required: true },
    day: { type: String, required: true },
    minutes: { type: Number, default: 0 },
    sessions: { type: Number, default: 0 },
  },
  { timestamps: true },
);
playerDailySchema.index({ robloxId: 1, day: 1 }, { unique: true });
playerDailySchema.index({ createdAt: 1 }, { expireAfterSeconds: DAILY_KEEP_S });

export const PlayerDaily = mongoose.model('PlayerDaily', playerDailySchema);

// A Roblox account matched to a Discord account by hand on the dashboard (for testers who never linked and whose
// Discord name doesn't give them away). Only for the Team tab: it gives no roles, unlike a RobloxLink.
const teamMatchSchema = new mongoose.Schema(
  {
    robloxId: { type: Number, required: true, unique: true },
    discordId: { type: String, required: true },
  },
  { timestamps: true },
);

export const TeamMatch = mongoose.model('TeamMatch', teamMatchSchema);
