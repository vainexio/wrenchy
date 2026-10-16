import mongoose from 'mongoose';

const groupRoleSchema = new mongoose.Schema(
  { id: Number, name: String, rank: Number },
  { _id: false },
);

// One Discord account <-> one Roblox account (global, not per server).
const robloxLinkSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true },
    robloxId: { type: Number, required: true, unique: true },
    username: { type: String, required: true },
    displayName: { type: String },
    // Every group role they hold. The game reports all of them (GetRolesInGroupAsync); Roblox's web API only
    // knows the highest one, so the periodic recheck only swaps that one (see roblox/sync.js).
    roles: { type: [groupRoleSchema], default: [] },
    rolesFrom: { type: String, enum: ['game', 'web'], default: 'game' },
    rolesAt: { type: Date, default: Date.now },
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const RobloxLink = mongoose.model('RobloxLink', robloxLinkSchema);
