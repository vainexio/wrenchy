import mongoose from 'mongoose';

// A sticky message: text the bot keeps as the LAST message of a channel (bot/sticky.js). One per channel. messageId is
// the copy that's up right now: each time something else is posted, a new copy goes up and the old one comes down.
const stickySchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    messageId: { type: String, default: null },
    setBy: { type: String }, // the Discord id of whoever wrote it
  },
  { timestamps: true },
);

export const Sticky = mongoose.model('Sticky', stickySchema);
