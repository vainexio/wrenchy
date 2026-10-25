import mongoose from 'mongoose';

const groupRoleSchema = new mongoose.Schema(
  { id: Number, name: String, rank: Number },
  { _id: false },
);

// One Discord account <-> one Roblox account (global, not per server): someone holding the server's Verified role
// (Bloxlink verified them) whose nickname is Bloxlink's "Display (@username)". roblox/verified.js keeps these in step
// with their role and nickname; it's also what the Team tab matches people by.
const robloxLinkSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true },
    robloxId: { type: Number, required: true, unique: true },
    username: { type: String, required: true },
    displayName: { type: String },
    // Their bound group roles, from each bound role's member list (Roblox lists a member under every role they hold,
    // extra roles too; its per-user API only gives the highest). See roblox/verified.js.
    roles: { type: [groupRoleSchema], default: [] },
    rolesAt: { type: Date, default: Date.now },
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const RobloxLink = mongoose.model('RobloxLink', robloxLinkSchema);
