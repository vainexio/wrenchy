import { checkAssignable } from '../bot/roles.js';
import { config } from '../config.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getKnownGroupRoles } from '../roblox/api.js';
import { syncEverywhere, syncMember } from '../roblox/sync.js';
import { HttpError } from './errors.js';
import { gameStatus } from './game.js';

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
  if (body.content !== undefined) rc.content = text(body.content, 'Message', 2000, true);
  if (body.buttonLabel !== undefined) rc.buttonLabel = text(body.buttonLabel, 'Button label', 80, true);
  if (body.buttonEmoji !== undefined) rc.buttonEmoji = text(body.buttonEmoji, 'Button emoji', 64, false);
  if (body.gameUrl !== undefined) {
    const url = text(body.gameUrl, 'Game link', 300, false);
    if (url && !/^https:\/\/(www\.)?roblox\.com\/\S+$/i.test(url)) {
      throw new HttpError(400, 'The game link must be a roblox.com link.');
    }
    rc.gameUrl = url;
  }
  if (body.nicknameEnabled !== undefined) rc.nicknameEnabled = Boolean(body.nicknameEnabled);
  if (body.nicknameFormat !== undefined) {
    const format = text(body.nicknameFormat, 'Nickname format', 100, true);
    if (!format.includes('{username}') && !format.includes('{display}')) {
      throw new HttpError(400, 'The nickname needs {username} or {display} in it.');
    }
    rc.nicknameFormat = format;
  }
  if (body.linkedRoleId !== undefined) {
    rc.linkedRoleId = body.linkedRoleId ? assignableRole(guild, body.linkedRoleId, 'Linked role') : null;
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

/** Resyncs every linked member in one server (after settings change, or "Sync everyone"). */
export async function syncGuild(guild, guildConfig) {
  const links = await RobloxLink.find();
  let changed = 0;
  for (const link of links) {
    try {
      const result = await syncMember(guild, guildConfig.roblox, link.discordId, link);
      if (result && (result.added.length || result.removed.length)) changed += 1;
    } catch (err) {
      console.error(`[roblox] sync failed for @${link.username}:`, err.message);
    }
  }
  return { linked: links.length, changed };
}

/** The Roblox tab's live data: group roles, linked staff, game connection. */
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
        rolesFrom: l.rolesFrom,
        rolesAt: l.rolesAt,
        syncedAt: l.syncedAt,
      };
    }),
  );
  return {
    groupId: config.defaultRobloxGroupId,
    groupRoles,
    links: members,
    game: { keySet: Boolean(config.gameApiKey), lastSeenAt: gameStatus.lastSeenAt },
  };
}

export async function unlink(client, discordId) {
  const link = await RobloxLink.findOneAndDelete({ discordId });
  if (!link) throw new HttpError(404, 'That member is not linked.');
  await syncEverywhere(client, discordId, null);
  console.log(`[roblox] dashboard unlinked @${link.username}`);
}
