import mongoose from 'mongoose';

// Every group role the bot has heard of. Roblox's public API hides private roles (the specializations, the perms
// roles), so the game's reports fill those in; the dashboard lists them for role bindings.
const robloxRoleSchema = new mongoose.Schema(
  {
    groupId: { type: Number, required: true },
    roleId: { type: Number, required: true },
    name: { type: String, required: true },
    rank: { type: Number, default: 0 },
  },
  { timestamps: true },
);
robloxRoleSchema.index({ groupId: 1, roleId: 1 }, { unique: true });

export const RobloxRole = mongoose.model('RobloxRole', robloxRoleSchema);
