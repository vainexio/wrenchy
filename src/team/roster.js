import { config } from '../config.js';
import { DiscordActivity, PlayerActivity, TeamMatch } from '../models/Activity.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getKnownGroupRoles, getRoleMembers } from '../roblox/api.js';

// The Team tab and /inactive: everyone in each team group (Testers, Staff...), from the Roblox group's role lists and
// the server's Discord roles, joined into one row per person, with when they last played and last chatted.
//
// A Roblox account and a Discord account are the same person when (in order): Bloxlink linked them (RobloxLink:
// the Verified role and their nickname, roblox/verified.js), someone matched them on the dashboard (TeamMatch), or the
// Discord name gives the Roblox username away (Bloxlink-style nicknames: "Name (@username)", "username", "@username").

const MEMBERS_TTL_MS = 10 * 60 * 1000;
const membersFetchedAt = new Map(); // guildId -> time

export const ONLINE_MS = 8 * 60 * 1000; // (a game heartbeat comes every 5 minutes)

/** Every server member (the Server Members intent), refetched at most every 10 minutes. */
async function getMembers(guild) {
  const at = membersFetchedAt.get(guild.id) ?? 0;
  if (Date.now() - at > MEMBERS_TTL_MS || guild.members.cache.size < guild.memberCount * 0.9) {
    await guild.members.fetch();
    membersFetchedAt.set(guild.id, Date.now());
  }
  return guild.members.cache;
}

const norm = (s) => (s ?? '').toLowerCase();

/** The Roblox username a Discord name gives away, if any ("Juan (@juan123)" -> "juan123"). */
function namesOf(member) {
  const names = new Set();
  for (const raw of [member.nickname, member.user.globalName, member.user.username]) {
    if (!raw) continue;
    const n = norm(raw).trim();
    names.add(n.replace(/^@/, ''));
    for (const m of n.matchAll(/@([a-z0-9_]{3,20})/g)) names.add(m[1]);
    const paren = n.match(/\(([a-z0-9_]{3,20})\)\s*$/);
    if (paren) names.add(paren[1]);
  }
  return names;
}

function daysSince(date) {
  return date ? (Date.now() - new Date(date).getTime()) / 86_400_000 : null;
}

/**
 * The team, one entry per group: { name, people: [...] } and the settings it was built with. Each person:
 * { robloxId, username, displayName, robloxRoles, discordId, discordName, discordAvatar, discordRoles, matchedBy,
 *   game: { lastSeenAt, online, minutes, sessions, game }, discord: { lastMessageAt, lastChannelId, messages },
 *   gameDays, discordDays, inactiveGame, inactiveDiscord }
 */
export async function buildTeam(guild, team) {
  const groupId = config.defaultRobloxGroupId;
  const [groupRoles, members, links, matches] = await Promise.all([
    getKnownGroupRoles(groupId),
    getMembers(guild),
    RobloxLink.find().lean(),
    TeamMatch.find().lean(),
  ]);
  const roleName = new Map(groupRoles.map((r) => [r.id, r.name]));
  const discordOf = new Map([...links.map((l) => [l.robloxId, { id: l.discordId, by: 'linked' }])]);
  for (const m of matches) if (!discordOf.has(m.robloxId)) discordOf.set(m.robloxId, { id: m.discordId, by: 'matched' });

  // (who could be who by name: every member's names)
  const byName = new Map();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    for (const n of namesOf(member)) if (!byName.has(n)) byName.set(n, member);
  }

  const groups = [];
  for (const g of team.groups) {
    const people = new Map(); // robloxId or "d:<discordId>" -> person
    // the Roblox side: everyone holding one of the group's roles
    for (const roleId of g.robloxRoleIds) {
      let users = [];
      try {
        users = await getRoleMembers(groupId, roleId);
      } catch (err) {
        console.error(`[team] can't list Roblox role ${roleId}:`, err.message);
      }
      for (const u of users) {
        const p = people.get(u.robloxId) ?? { ...u, robloxRoles: [] };
        p.robloxRoles.push(roleName.get(roleId) ?? String(roleId));
        people.set(u.robloxId, p);
      }
    }
    // their Discord accounts
    const used = new Set();
    for (const p of people.values()) {
      const known = discordOf.get(p.robloxId);
      const member = known ? members.get(known.id) : byName.get(norm(p.username));
      if (member) {
        p.discordId = member.id;
        p.matchedBy = known?.by ?? 'name';
        used.add(member.id);
      } else if (known) {
        p.discordId = known.id; // (linked, but not in this server)
        p.matchedBy = known.by;
      }
    }
    // the Discord side: anyone with one of the group's Discord roles nobody above is
    const roleIds = new Set(g.discordRoleIds);
    for (const member of members.values()) {
      if (used.has(member.id) || member.user.bot || !member.roles.cache.some((r) => roleIds.has(r.id))) continue;
      people.set(`d:${member.id}`, { robloxId: null, username: null, displayName: null, robloxRoles: [], discordId: member.id, matchedBy: null });
    }

    const list = [...people.values()];
    const robloxIds = list.map((p) => p.robloxId).filter(Boolean);
    const discordIds = list.map((p) => p.discordId).filter(Boolean);
    const [plays, chats] = await Promise.all([
      PlayerActivity.find({ robloxId: { $in: robloxIds } }).lean(),
      DiscordActivity.find({ guildId: guild.id, userId: { $in: discordIds } }).lean(),
    ]);
    const playOf = new Map(plays.map((a) => [a.robloxId, a]));
    const chatOf = new Map(chats.map((a) => [a.userId, a]));

    for (const p of list) {
      const member = p.discordId ? members.get(p.discordId) : null;
      p.discordName = member?.displayName ?? null;
      p.discordAvatar = member?.user.displayAvatarURL({ size: 64 }) ?? null;
      p.inServer = Boolean(member);
      p.discordRoles = member ? member.roles.cache.filter((r) => roleIds.has(r.id)).map((r) => r.name) : [];
      const play = p.robloxId ? playOf.get(p.robloxId) : null;
      const online = Boolean(play?.online && Date.now() - new Date(play.lastSeenAt).getTime() < ONLINE_MS);
      p.game = play
        ? { lastSeenAt: play.lastSeenAt, online, minutes: play.minutes, sessions: play.sessions, game: play.game }
        : null;
      const chat = p.discordId ? chatOf.get(p.discordId) : null;
      p.discord = chat ? { lastMessageAt: chat.lastMessageAt, lastChannelId: chat.lastChannelId, messages: chat.messages } : null;
      p.gameDays = online ? 0 : daysSince(play?.lastSeenAt);
      p.discordDays = daysSince(chat?.lastMessageAt);
      // (inactive = not seen for the set days, or never seen at all; nothing to judge without the account)
      p.inactiveGame = p.robloxId ? p.gameDays === null || p.gameDays >= team.inactiveDays : null;
      p.inactiveDiscord = p.discordId && p.inServer ? p.discordDays === null || p.discordDays >= team.inactiveDays : null;
    }
    // the least active first
    const score = (p) => Math.min(p.gameDays ?? 1e6, p.discordDays ?? 1e6);
    list.sort((a, b) => score(b) - score(a) || (a.username ?? a.discordName ?? '').localeCompare(b.username ?? b.discordName ?? ''));
    groups.push({ name: g.name, people: list });
  }
  return groups;
}

/** When game tracking began: the first activity ever reported. */
export async function gameTrackingSince() {
  const first = await PlayerActivity.findOne().sort({ createdAt: 1 }).lean();
  return first?.createdAt ?? null;
}
