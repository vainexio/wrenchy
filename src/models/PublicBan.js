import mongoose from 'mongoose';

// A ban the game reported (POST /api/game/ban) and the public post made for it. One open record per player: a second
// report while the ban stands (a retry, a new length) edits the same post; an unban deletes the post and closes it.
const publicBanSchema = new mongoose.Schema(
  {
    robloxId: { type: Number, required: true, index: true },
    username: { type: String, required: true },
    displayName: { type: String },
    reason: { type: String, required: true }, // the broad reason the public sees, never the moderator's own words
    seconds: { type: Number, required: true }, // -1 = for good
    game: { type: String },
    bannedAt: { type: Date, required: true },
    channelId: { type: String },
    messageId: { type: String },
    liftedAt: { type: Date, default: null }, // set when the game reports the unban
  },
  { timestamps: true },
);

export const PublicBan = mongoose.model('PublicBan', publicBanSchema);
