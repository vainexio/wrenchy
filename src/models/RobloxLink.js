import mongoose from 'mongoose';

const groupRoleSchema = new mongoose.Schema(
  { id: Number, name: String, rank: Number },
  { _id: false },
);

// One Discord account <-> one Roblox account (global, not per server). Made two ways (`source`):
//   game      the member typed their code with /link in the game (the game vouches for who they are)
//   nickname  they hold the server's Verified role (Bloxlink verified them) and their nickname is Bloxlink's
//             "Display (@username)": roblox/verified.js keeps these in step with their role and nickname.
// A game link always wins: a nickname never replaces one.
const robloxLinkSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true },
    robloxId: { type: Number, required: true, unique: true },
    username: { type: String, required: true },
    displayName: { type: String },
    // Every group role they hold that matters here. From the web: each bound role's member list (Roblox lists a
    // member under every role they hold, extra roles too; its per-user API only gives the highest). From the game:
    // all of them, private roles included, whenever they play (GetRolesInGroupAsync). See roblox/sync.js.
    roles: { type: [groupRoleSchema], default: [] },
    rolesFrom: { type: String, enum: ['game', 'web'], default: 'game' },
    source: { type: String, enum: ['game', 'nickname'], default: 'game' },
    rolesAt: { type: Date, default: Date.now },
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const RobloxLink = mongoose.model('RobloxLink', robloxLinkSchema);
