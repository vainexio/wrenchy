import mongoose from 'mongoose';

// What was done to whom on the Team tab, kept for good: added, role changed, suspended, removed, reinstated, sent a
// notice. Each keeps a snapshot of the person's activity and roles at the time, as proof if a removal is disputed
// (the owner, 2026-10-30: "they will be removed from tester role on the group but data still stays for proof in case
// of dispute").
const teamRecordSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    kind: { type: String, required: true, enum: ['added', 'role', 'suspended', 'removed', 'reinstated', 'notice'] },
    robloxId: { type: Number, default: null, index: true },
    username: { type: String, default: null }, // (Roblox)
    discordId: { type: String, default: null, index: true },
    discordName: { type: String, default: null },
    group: { type: String, default: null }, // (the team group, for added)
    from: { type: String, default: null }, // (role names: "Tester" -> "Member")
    to: { type: String, default: null },
    reason: { type: String, default: '' }, // (for a notice: its text)
    by: { id: String, name: String },
    // (their activity and roles when it happened: { lastPlayedAt, minutesPlayed, sessions, lastMessageAt, messages,
    //  robloxRole, discordRoles })
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // (a suspension: what to give back on reinstating, and when that happened)
    previous: { robloxRoleId: { type: Number, default: null }, discordRoleIds: { type: [String], default: [] } },
    reinstatedAt: { type: Date, default: null },
    delivered: { type: Boolean, default: null }, // (a notice: whether the DM went through)
    problems: { type: [String], default: [] },
  },
  { timestamps: true },
);
teamRecordSchema.index({ guildId: 1, createdAt: -1 });

export const TeamRecord = mongoose.model('TeamRecord', teamRecordSchema);

// A notice: one message DMed to a list of team members. Sent in the background; `sent` and `failed` fill in as it goes.
const noticeSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    message: { type: String, required: true },
    audience: { type: String, default: '' }, // ("Testers · Inactive", "3 picked people")
    by: { id: String, name: String },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: [{ discordId: String, name: String, error: String }], default: [] },
    // (everyone it's for, and how it went for each, so the dashboard can say who it was sent to)
    to: { type: [String], default: [] },
    recipients: { type: [{ discordId: String, name: String, delivered: Boolean, error: String, _id: false }], default: [] },
    status: { type: String, enum: ['sending', 'done'], default: 'sending' },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
noticeSchema.index({ guildId: 1, createdAt: -1 });

export const Notice = mongoose.model('Notice', noticeSchema);
