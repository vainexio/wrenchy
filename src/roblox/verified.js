import { config } from '../config.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getKnownGroupRoles, getRoleMembers, resolveUsernames } from './api.js';
import { syncMember } from './sync.js';

// RANK SYNC FROM BLOXLINK (the owner, 2026-10-25: "if they have "Verified" role, then that means they are verified by
// the bloxlink bot and their nickname would be "display name (@username)" ... Use that as the bind, and thennn. Bind
// their roles from the group"). A member holding the server's Verified role (GuildConfig roblox.verifiedRoleId) whose
// nickname ends in "(@username)" is linked to that Roblox account (a RobloxLink). Bloxlink, an outside bot, does the
// verifying: Wrenchy only reads its role and nickname ("bloxlink handles the linking ... u just base it on their
// nicknames if they are verified and has the verified role"). Their group roles come from the bound roles' member
// lists, which list a member under EVERY role they hold (the per-user API only gives the highest). Then the role
// bindings give and take their Discord roles (roblox/sync.js syncMember). No timer and nothing from the game ("No need
// for play time and interval updates"): it runs when
//   updateMember(guild, rc, member)   one member: /update, or their Verified role or nickname changes
//   updateGuild(guild, rc, opts)      every Verified or linked member: /updateall, the dashboard's Update everyone and
//                                     a saved Roblox Link page
// Someone who loses the Verified role (or whose nickname stops naming the account) is unlinked and loses the bound
// roles. A Verified member with no "(@username)" in their nickname is only reported: nothing of theirs is touched.

/** The Roblox username a Bloxlink nickname names ("vai (@VA1_N)" -> "VA1_N"), or null. */
export function nicknameUsername(member) {
  const m = (member.nickname ?? '').match(/\(@([A-Za-z0-9_]{3,20})\)\s*$/);
  return m ? m[1] : null;
}

export const isVerified = (rc, member) => Boolean(rc.verifiedRoleId && member.roles.cache.has(rc.verifiedRoleId));

/**
 * What the role sync needs, asked once per run: the known group roles, and who holds each bound role (public ones:
 * Roblox hides a private role's members, so binding one does nothing). fresh = straight from Roblox (/update), else
 * the 10-minute cache.
 */
export async function rolesContext(rc, { fresh = false } = {}) {
  const groupId = config.defaultRobloxGroupId;
  const known = new Map((await getKnownGroupRoles(groupId)).map((r) => [r.id, r]));
  const holders = new Map(); // robloxId -> Set(roleId)
  const fetched = new Set(); // the roles whose member lists were read
  for (const b of rc.bindings) {
    const role = known.get(b.robloxRoleId);
    if (!role || role.hidden || fetched.has(role.id)) continue;
    for (const u of await getRoleMembers(groupId, role.id, { fresh })) {
      if (!holders.has(u.robloxId)) holders.set(u.robloxId, new Set());
      holders.get(u.robloxId).add(role.id);
    }
    fetched.add(role.id);
  }
  return { known, holders, fetched, resolved: new Map() };
}

/** A link's bound group roles, from the member lists. Changed? */
function refreshRoles(link, ctx) {
  const next = [...(ctx.holders.get(link.robloxId) ?? [])].map((id) => {
    const r = ctx.known.get(id);
    return { id: r.id, name: r.name, rank: r.rank };
  });
  const key = (list) => list.map((r) => r.id).sort().join(',');
  if (key(next) === key(link.roles)) return false;
  link.roles = next;
  link.rolesAt = new Date();
  return true;
}

/** The member's link after checking their Verified role and nickname: { link, created, unlinked, why }. */
async function linkFor(rc, member, ctx) {
  const existing = await RobloxLink.findOne({ discordId: member.id });
  const drop = async (why) => {
    if (existing) await existing.deleteOne();
    return { link: null, unlinked: existing ?? null, why };
  };
  if (!rc.verifiedRoleId) return drop(null);
  if (!isVerified(rc, member)) return drop('not verified');
  const name = nicknameUsername(member);
  if (!name) return drop('nickname isn’t “Display (@username)”');
  const key = name.toLowerCase();
  let user = ctx.resolved.get(key);
  if (!user) {
    user = (await resolveUsernames([name])).get(key);
    if (user) ctx.resolved.set(key, user);
  }
  if (!user) return drop(`no Roblox account called @${name}`);
  const taken = await RobloxLink.findOne({ robloxId: user.robloxId, discordId: { $ne: member.id } });
  if (taken) return drop(`@${user.username} is already linked to <@${taken.discordId}>`);
  if (existing) {
    if (existing.robloxId !== user.robloxId) existing.roles = []; // (a different account: its roles come fresh)
    Object.assign(existing, user);
    return { link: existing };
  }
  const link = new RobloxLink({ discordId: member.id, ...user, roles: [] });
  return { link, created: true };
}

/**
 * Updates one member: their link, their group roles, then their Discord roles. Returns { member, link, created,
 * unlinked, why, added, removed, problems }.
 */
export async function updateMember(guild, rc, member, ctx) {
  ctx ??= await rolesContext(rc, { fresh: true });
  const { link, created, unlinked, why } = await linkFor(rc, member, ctx);
  const out = { member, link, created: Boolean(created), unlinked, why, added: [], removed: [], problems: [] };
  if (link) {
    refreshRoles(link, ctx);
    Object.assign(out, await syncMember(guild, rc, member, link));
    link.syncedAt = new Date();
    await link.save();
  } else if (unlinked) {
    Object.assign(out, await syncMember(guild, rc, member, null)); // (the bound roles come off)
  }
  return out;
}

/**
 * Updates everyone in the server who holds the Verified role or is linked. onProgress(done, total) now and then.
 * Returns { checked, linked, changed, unlinked, notLinked: [{ member, why }], problems: [text] }.
 */
export async function updateGuild(guild, rc, { fresh = false, onProgress } = {}) {
  const ctx = await rolesContext(rc, { fresh });
  await guild.members.fetch();
  const linkedIds = new Set((await RobloxLink.find({}, { discordId: 1 }).lean()).map((l) => l.discordId));
  const members = [...guild.members.cache.values()].filter((m) => !m.user.bot && (linkedIds.has(m.id) || isVerified(rc, m)));
  const names = members.map(nicknameUsername).filter(Boolean);
  if (names.length) ctx.resolved = await resolveUsernames(names);

  const summary = { checked: 0, linked: 0, changed: 0, unlinked: 0, notLinked: [], problems: [] };
  for (const member of members) {
    try {
      const r = await updateMember(guild, rc, member, ctx);
      if (r.link) summary.linked += 1;
      if (r.unlinked) summary.unlinked += 1;
      if (r.added.length || r.removed.length) summary.changed += 1;
      if (!r.link && r.why && r.why !== 'not verified') summary.notLinked.push({ member, why: r.why });
      for (const p of r.problems) summary.problems.push(`${member.displayName}: ${p}`);
    } catch (err) {
      summary.problems.push(`${member.displayName}: ${err.message}`);
    }
    summary.checked += 1;
    if (summary.checked % 10 === 0) await onProgress?.(summary.checked, members.length);
  }
  return summary;
}
