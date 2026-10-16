import { config } from '../config.js';
import { GuildConfig } from '../models/GuildConfig.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getUserTopRole } from './api.js';

/** Discord role ids this config manages: anything it might give, so it can also take them away. */
function managedRoleIds(rc) {
  const ids = new Set(rc.bindings.flatMap((b) => b.discordRoleIds));
  if (rc.linkedRoleId) ids.add(rc.linkedRoleId);
  return ids;
}

/** Discord role ids this linked member should have under this config. */
export function desiredRoleIds(rc, link) {
  const ids = new Set();
  if (!link) return ids;
  if (rc.linkedRoleId) ids.add(rc.linkedRoleId);
  const held = new Set(link.roles.map((r) => r.id));
  for (const b of rc.bindings) {
    if (held.has(b.robloxRoleId)) b.discordRoleIds.forEach((id) => ids.add(id));
  }
  return ids;
}

function nickname(rc, link) {
  const nick = rc.nicknameFormat
    .replaceAll('{username}', link.username)
    .replaceAll('{display}', link.displayName || link.username);
  return nick.slice(0, 32); // Discord's limit
}

/**
 * Brings one member's Discord roles (and nickname) in line with their link. `link` null = unlinked: every managed
 * role comes off. Returns { added, removed, problems } or null if they're not in the server.
 */
export async function syncMember(guild, rc, discordId, link) {
  const member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
  if (!member) return null;

  const me = guild.members.me;
  const canManage = (id) => {
    const role = guild.roles.cache.get(id);
    return role && !role.managed && role.position < me.roles.highest.position;
  };
  const want = desiredRoleIds(rc, link);
  const add = [...want].filter((id) => !member.roles.cache.has(id) && canManage(id));
  const remove = [...managedRoleIds(rc)].filter((id) => !want.has(id) && member.roles.cache.has(id) && canManage(id));
  const problems = [...want].filter((id) => !canManage(id)).map((id) => `can't assign <@&${id}>`);

  if (add.length) await member.roles.add(add, 'Roblox link sync');
  if (remove.length) await member.roles.remove(remove, 'Roblox link sync');

  if (rc.nicknameEnabled) {
    const nick = link ? nickname(rc, link) : null;
    if ((member.nickname ?? null) !== nick) {
      // (the server owner and anyone above Wrenchy can't be renamed)
      await member.setNickname(nick, 'Roblox link sync').catch(() => problems.push("can't change nickname"));
    }
  }
  return { added: add, removed: remove, problems };
}

/** Syncs a link in every server the bot shares with them that has Roblox linking on. */
export async function syncEverywhere(client, discordId, link) {
  const configs = await GuildConfig.find({ 'roblox.enabled': true });
  for (const gc of configs) {
    const guild = client.guilds.cache.get(gc.guildId);
    if (!guild) continue;
    try {
      await syncMember(guild, gc.roblox, discordId, link);
    } catch (err) {
      console.error(`[roblox] sync failed for ${discordId} in ${guild.name}:`, err.message);
    }
  }
  if (link) {
    link.syncedAt = new Date();
    await link.save();
  }
}

/**
 * Rechecks a link's group roles on the web. The web only knows the HIGHEST role, so: not in the group -> no roles;
 * a new highest role -> it replaces the old highest one and their lower (extra) roles are kept as last reported by
 * the game. The game sends the full list whenever they play.
 */
export async function refreshFromWeb(link, groupId) {
  const top = await getUserTopRole(link.robloxId, groupId);
  const currentTop = link.roles.reduce((best, r) => (!best || r.rank > best.rank ? r : best), null);
  if (!top) {
    if (link.roles.length === 0) return false;
    link.roles = [];
  } else if (currentTop?.id === top.id) {
    return false;
  } else {
    link.roles = [top, ...link.roles.filter((r) => r.id !== currentTop?.id && r.rank < top.rank)];
  }
  link.rolesFrom = 'web';
  link.rolesAt = new Date();
  await link.save();
  return true;
}

/** Periodic job: recheck every link on the web, then resync everyone. */
export async function recheckAll(client) {
  const links = await RobloxLink.find();
  const groupId = config.defaultRobloxGroupId;
  let changed = 0;
  for (const link of links) {
    try {
      if (await refreshFromWeb(link, groupId)) changed += 1;
    } catch (err) {
      console.error(`[roblox] recheck failed for @${link.username}:`, err.message);
    }
    await syncEverywhere(client, link.discordId, link);
    await new Promise((r) => setTimeout(r, 500)); // (gentle on Roblox's rate limits)
  }
  if (links.length) console.log(`[roblox] rechecked ${links.length} link(s), ${changed} rank change(s)`);
}
