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
  },
  { timestamps: true },
);
discordActivitySchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const DiscordActivity = mongoose.model('DiscordActivity', discordActivitySchema);

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
