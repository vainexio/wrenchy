import { GuildConfig } from '../models/GuildConfig.js';

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
 * role comes off. `who` is their Discord id (fetched fresh) or the GuildMember itself (updateGuild has them all).
 * Returns { added, removed, problems } or null if they're not in the server.
 */
export async function syncMember(guild, rc, who, link) {
  const member = typeof who === 'string' ? await guild.members.fetch({ user: who, force: true }).catch(() => null) : who;
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

  // (a nickname link's nickname is Bloxlink's, and it's what links them: never touched)
  if (rc.nicknameEnabled && link?.source !== 'nickname') {
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
