import mongoose from 'mongoose';

// One person's onboarding: the guide's steps they have to go through (the ones they'd already done are left out), how
// far they are, and whether they've been ranked. Their guide is a message (a DM, or in the fallback channel) edited
// step by step.
const onboardingStepStateSchema = new mongoose.Schema(
  {
    id: String, // (the guide's step)
    kind: String,
    title: String,
    doneAt: { type: Date, default: null },
  },
  { _id: false },
);

const onboardingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    discordId: { type: String, required: true },
    discordName: { type: String, default: '' },
    group: { type: String, required: true }, // (the team group)
    robloxRoleId: { type: Number, default: null }, // (the role they get)
    robloxId: { type: Number, default: null }, // (given when added, or found once they verify)
    username: { type: String, default: null },
    steps: { type: [onboardingStepStateSchema], default: [] },
    status: { type: String, enum: ['active', 'done', 'cancelled'], default: 'active' },
    ranked: { type: Boolean, default: false },
    rankedAt: { type: Date, default: null },
    delivery: { type: String, enum: ['dm', 'channel', 'none'], default: 'none' }, // (where the guide is)
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    note: { type: String, default: '' }, // (what the last check found: "not in the community yet"...)
    by: { id: String, name: String },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
onboardingSchema.index({ guildId: 1, createdAt: -1 });
onboardingSchema.index({ guildId: 1, discordId: 1, status: 1 });

export const Onboarding = mongoose.model('Onboarding', onboardingSchema);
