import { checkAssignable } from '../bot/roles.js';
import { config } from '../config.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getKnownGroupRoles } from '../roblox/api.js';
import { isVerified, nicknameUsername, updateGuild } from '../roblox/verified.js';
import { HttpError } from './errors.js';

const MAX_BINDINGS = 50;

function text(value, name, max, required) {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text.`);
  const t = value.trim();
  if (required && !t) throw new HttpError(400, `${name} can't be empty.`);
  if (t.length > max) throw new HttpError(400, `${name} must be at most ${max} characters.`);
  return t;
}

function assignableRole(guild, id, what) {
  const role = guild.roles.cache.get(id);
  if (!role) throw new HttpError(400, `${what}: that Discord role no longer exists.`);
  const problem = checkAssignable(guild, role);
  if (problem) throw new HttpError(400, `${what}: ${problem}`);
  return role.id;
}

/** Applies the Roblox tab's form to guildConfig.roblox (validates everything first). */
export async function applyRoblox(guild, guildConfig, body) {
  const rc = guildConfig.roblox;
  if (body.enabled !== undefined) rc.enabled = Boolean(body.enabled);
  if (body.linkedRoleId !== undefined) {
    rc.linkedRoleId = body.linkedRoleId ? assignableRole(guild, body.linkedRoleId, 'Linked role') : null;
  }
  // (Bloxlink's Verified role: read, never given, so any role will do)
  if (body.verifiedRoleId !== undefined) {
    if (body.verifiedRoleId && !guild.roles.cache.has(body.verifiedRoleId)) {
      throw new HttpError(400, 'Verified role: that Discord role no longer exists.');
    }
    rc.verifiedRoleId = body.verifiedRoleId || null;
  }

  if (body.bindings !== undefined) {
    if (!Array.isArray(body.bindings)) throw new HttpError(400, 'bindings must be a list.');
    if (body.bindings.length > MAX_BINDINGS) throw new HttpError(400, `At most ${MAX_BINDINGS} role bindings.`);
    const known = new Map((await getKnownGroupRoles(config.defaultRobloxGroupId)).map((r) => [r.id, r]));
    const seen = new Set();
    rc.bindings = body.bindings.map((b, i) => {
      const what = `Binding ${i + 1}`;
      const robloxRoleId = Number(b?.robloxRoleId);
      if (!Number.isSafeInteger(robloxRoleId) || robloxRoleId <= 0) throw new HttpError(400, `${what}: pick a Roblox role.`);
      if (seen.has(robloxRoleId)) throw new HttpError(400, `${what}: that Roblox role already has a binding.`);
      seen.add(robloxRoleId);
      const discordRoleIds = [...new Set(Array.isArray(b.discordRoleIds) ? b.discordRoleIds : [])].map((id) =>
        assignableRole(guild, id, what),
      );
      if (!discordRoleIds.length) throw new HttpError(400, `${what}: pick at least one Discord role.`);
      const name = known.get(robloxRoleId)?.name ?? text(b.robloxRoleName ?? '', `${what} name`, 100, false);
      return { robloxRoleId, robloxRoleName: name, discordRoleIds };
    });
  }
}

/** Updates everyone Verified or linked in one server (after settings change, or "Sync everyone"). */
export async function syncGuild(guild, guildConfig, { fresh = false } = {}) {
  return updateGuild(guild, guildConfig.roblox, { fresh });
}

/** The Roblox tab's live data: group roles, linked members, the Verified members it can't read. */
export async function robloxOverview(client, guild) {
  const [groupRoles, links] = await Promise.all([
    getKnownGroupRoles(config.defaultRobloxGroupId),
    RobloxLink.find().sort({ updatedAt: -1 }).lean(),
  ]);
  const members = await Promise.all(
    links.map(async (l) => {
      const member = await guild.members.fetch(l.discordId).catch(() => null);
      const user = member?.user ?? (await client.users.fetch(l.discordId).catch(() => null));
      return {
        discordId: l.discordId,
        discordName: member?.displayName ?? user?.username ?? 'Unknown user',
        discordAvatar: user?.displayAvatarURL({ size: 64 }) ?? null,
        inServer: Boolean(member),
        robloxId: l.robloxId,
        username: l.username,
        displayName: l.displayName,
        roles: l.roles.slice().sort((a, b) => b.rank - a.rank),
        rolesAt: l.rolesAt,
        syncedAt: l.syncedAt,
      };
    }),
  );
  // Bloxlink: Verified members whose nickname doesn't name a Roblox account (they can't be linked)
  const rc = (await getGuildConfig(guild.id)).roblox;
  const linked = new Set(links.map((l) => l.discordId));
  const verified = rc.verifiedRoleId ? guild.members.cache.filter((m) => !m.user.bot && isVerified(rc, m)) : new Map();
  const unreadable = [...verified.values()]
    .filter((m) => !linked.has(m.id) && !nicknameUsername(m))
    .map((m) => ({ discordId: m.id, discordName: m.displayName, nickname: m.nickname ?? null }));
  return {
    groupId: config.defaultRobloxGroupId,
    groupRoles,
    links: members,
    verified: { count: verified.size, unreadable },
  };
}
