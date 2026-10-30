import { config } from '../config.js';
import { TeamMatch } from '../models/Activity.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getKnownGroupRoles } from '../roblox/api.js';
import { rankByName } from '../shared/search.js';
import { scanHistory, scans } from '../team/discordActivity.js';
import { buildTeam, gameTrackingSince, getMembers } from '../team/roster.js';
import { HttpError } from './errors.js';
import { gameStatus } from './game.js';

const MAX_GROUPS = 8;
const SEARCH_LIMIT = 25;

/**
 * Server members whose username, display name, nickname or ID matches `q`, best first (the Match Discord picker):
 * { results: [{ id, username, globalName, nickname, displayName, avatar, roles, linkedTo, matched }], total }.
 * Searched here so the dashboard never loads the whole member list.
 */
export async function searchMembers(guild, q, limit) {
  const query = String(q ?? '').trim().slice(0, 100);
  if (!query) return { results: [], total: 0 };
  const members = [...(await getMembers(guild)).values()].filter((m) => !m.user.bot);
  const ranked = rankByName(members, query, (m) => [m.user.username, m.user.globalName, m.nickname, m.displayName, m.id]);
  const top = ranked.slice(0, Math.min(Math.max(Number(limit) || SEARCH_LIMIT, 1), 50)).map((r) => r.item);
  const ids = top.map((m) => m.id);
  const [links, matches] = await Promise.all([
    RobloxLink.find({ discordId: { $in: ids } }, { discordId: 1, username: 1 }).lean(),
    TeamMatch.find({ discordId: { $in: ids } }, { discordId: 1 }).lean(),
  ]);
  const linkOf = new Map(links.map((l) => [l.discordId, l.username]));
  const matched = new Set(matches.map((m) => m.discordId));
  return {
    total: ranked.length,
    results: top.map((m) => ({
      id: m.id,
      username: m.user.username,
      globalName: m.user.globalName ?? null,
      nickname: m.nickname ?? null,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ size: 64 }),
      // (their highest few roles, to tell people with the same name apart)
      roles: m.roles.cache
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .first(3)
        .map((r) => r.name),
      linkedTo: linkOf.get(m.id) ?? null,
      matched: matched.has(m.id),
    })),
  };
}

/** The Team tab: its settings, every group's people and activity, the history scan's progress. */
export async function teamOverview(guild) {
  const gc = await getGuildConfig(guild.id);
  const team = gc.team;
  const [groups, groupRoles, gameSince] = await Promise.all([
    buildTeam(guild, team),
    getKnownGroupRoles(config.defaultRobloxGroupId),
    gameTrackingSince(),
  ]);
  return {
    settings: {
      inactiveDays: team.inactiveDays,
      minMessagesWeek: team.minMessagesWeek,
      minMinutesWeek: team.minMinutesWeek,
      groups: team.groups.map((g) => ({ name: g.name, robloxRoleIds: [...g.robloxRoleIds], discordRoleIds: [...g.discordRoleIds] })),
    },
    groupId: config.defaultRobloxGroupId,
    groupRoles: groupRoles.filter((r) => r.rank > 1),
    groups,
    since: { game: gameSince, discord: team.discordSince, scannedAt: team.scannedAt, daily: team.dailySince },
    scan: scans.get(guild.id) ?? null,
    game: { keySet: Boolean(config.gameApiKey), lastSeenAt: gameStatus.lastSeenAt },
  };
}

/** Saves the Team settings: the groups (a name, Roblox roles, Discord roles) and the inactive days. */
export async function saveTeam(guild, body) {
  const gc = await getGuildConfig(guild.id);
  if (body.inactiveDays !== undefined) {
    const days = Number(body.inactiveDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpError(400, 'Inactive after must be 1 to 90 days.');
    gc.team.inactiveDays = days;
  }
  for (const [key, label, max] of [['minMessagesWeek', 'Messages a week', 1000], ['minMinutesWeek', 'Minutes played a week', 10000]]) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${label} must be 0 to ${max}.`);
    gc.team[key] = n;
  }
  if (body.groups !== undefined) {
    if (!Array.isArray(body.groups) || !body.groups.length) throw new HttpError(400, 'Keep at least one group.');
    if (body.groups.length > MAX_GROUPS) throw new HttpError(400, `At most ${MAX_GROUPS} groups.`);
    gc.team.groups = body.groups.map((g, i) => {
      const name = typeof g?.name === 'string' ? g.name.trim().slice(0, 40) : '';
      if (!name) throw new HttpError(400, `Group ${i + 1} needs a name.`);
      const robloxRoleIds = [...new Set((g.robloxRoleIds ?? []).map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0);
      const discordRoleIds = [...new Set(g.discordRoleIds ?? [])].filter((id) => guild.roles.cache.has(id));
      if (!robloxRoleIds.length && !discordRoleIds.length) throw new HttpError(400, `${name}: pick at least one role.`);
      return { name, robloxRoleIds, discordRoleIds };
    });
  }
  await gc.save();
}

/** Matches a Roblox account to a Discord member by hand (discordId null = forget the match). */
export async function matchMember(guild, body) {
  const robloxId = Number(body?.robloxId);
  if (!Number.isSafeInteger(robloxId) || robloxId <= 0) throw new HttpError(400, 'Bad Roblox account.');
  if (!body.discordId) {
    await TeamMatch.deleteOne({ robloxId });
    return;
  }
  const member = await guild.members.fetch(String(body.discordId)).catch(() => null);
  if (!member) throw new HttpError(400, 'That Discord account is not in this server.');
  await TeamMatch.updateOne({ robloxId }, { $set: { discordId: member.id } }, { upsert: true });
}

export function startScan(guild) {
  return scanHistory(guild);
}
