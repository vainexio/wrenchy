import mongoose from 'mongoose';

// One ticket: its channel, who opened it and what they answered, who handled it, and when it closed. Kept after the
// channel is deleted, with its transcript, so the dashboard can still show what was said.
const transcriptMessageSchema = new mongoose.Schema(
  {
    authorId: String,
    author: String,
    avatar: String,
    bot: Boolean,
    content: String,
    at: Date,
    attachments: [{ name: String, url: String, _id: false }],
    embeds: [{ title: String, description: String, _id: false }],
  },
  { _id: false },
);

const ticketSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    typeId: { type: String, required: true },
    typeName: { type: String, default: '' },
    number: { type: Number, required: true },
    name: { type: String, required: true }, // (the channel's name when it opened: "cc-apps-0001")
    channelId: { type: String, required: true, index: true },
    openerId: { type: String, required: true },
    openerName: { type: String, default: '' },
    status: { type: String, enum: ['open', 'closed', 'deleted'], default: 'open' },
    answers: { type: [{ question: String, answer: String, _id: false }], default: [] },
    addedUserIds: { type: [String], default: [] },
    claimedBy: { id: String, name: String },
    closedAt: { type: Date, default: null },
    closedBy: { id: String, name: String },
    closeReason: { type: String, default: '' },
    deletedAt: { type: Date, default: null },
    transcript: { type: [transcriptMessageSchema], default: [] }, // (saved when it closes)
    transcriptAt: { type: Date, default: null },
  },
  { timestamps: true },
);
ticketSchema.index({ guildId: 1, createdAt: -1 });
ticketSchema.index({ guildId: 1, openerId: 1, typeId: 1, status: 1 });

export const Ticket = mongoose.model('Ticket', ticketSchema);

// Each ticket type's last number, counted up as tickets open (cc-apps-0001, cc-apps-0002...).
const ticketCounterSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  typeId: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
ticketCounterSchema.index({ guildId: 1, typeId: 1 }, { unique: true });

export const TicketCounter = mongoose.model('TicketCounter', ticketCounterSchema);
