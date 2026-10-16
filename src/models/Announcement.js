import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    mode: { type: String, enum: ['text', 'embed'], required: true },
    summary: { type: String }, // short preview for the history list
    sentBy: {
      id: String,
      name: String,
    },
  },
  { timestamps: true },
);

export const Announcement = mongoose.model('Announcement', announcementSchema);
