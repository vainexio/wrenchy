import { config } from '../config.js';
import { TeamMatch } from '../models/Activity.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { getKnownGroupRoles } from '../roblox/api.js';
import { scanHistory, scans } from '../team/discordActivity.js';
import { buildTeam, gameTrackingSince } from '../team/roster.js';
import { HttpError } from './errors.js';
import { gameStatus } from './game.js';

const MAX_GROUPS = 8;

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
      groups: team.groups.map((g) => ({ name: g.name, robloxRoleIds: [...g.robloxRoleIds], discordRoleIds: [...g.discordRoleIds] })),
    },
    groupId: config.defaultRobloxGroupId,
    groupRoles: groupRoles.filter((r) => r.rank > 1),
    groups,
    since: { game: gameSince, discord: team.discordSince, scannedAt: team.scannedAt },
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
