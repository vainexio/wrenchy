import { rankByName } from '../../src/shared/search.js';

// What the Team pages know about each person (shared by People, the person panel, Add member and Notices): their
// status, how their accounts were joined, everyone once across the groups.

export function played(minutes) {
  if (!minutes) return 'no time yet';
  return `${hours(minutes)} played`;
}

/** 0m, 45m, 3.5h, 12h */
export function hours(minutes) {
  if (!minutes) return '0m';
  return minutes < 60 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h`;
}

export const STATUSES = [
  { value: 'inactive', label: 'Inactive', test: (p) => p.inactiveGame || p.inactiveDiscord },
  { value: 'game', label: 'Not playing', test: (p) => p.inactiveGame },
  { value: 'discord', label: 'Quiet on Discord', test: (p) => p.inactiveDiscord },
  { value: 'low', label: 'Low activity', test: (p) => Boolean(p.lowChat || p.lowGame) },
  { value: 'checkins', label: 'Checks in only', test: (p) => Boolean(p.chat?.checkIns) },
  { value: 'active', label: 'Active', test: (p) => !p.inactiveGame && !p.inactiveDiscord && !p.lowChat && !p.lowGame },
  { value: 'online', label: 'In game now', test: (p) => p.game?.online },
];

/** How their Roblox and Discord accounts were put together (or which one is missing). */
export function accountOf(p) {
  if (!p.robloxId) return 'noRoblox';
  if (!p.discordId) return 'noDiscord';
  if (!p.inServer) return 'left';
  return p.matchedBy; // linked | matched | name
}
export const ACCOUNTS = {
  linked: { label: 'Linked by Bloxlink', icon: 'link' },
  matched: { label: 'Matched by hand', icon: 'link' },
  name: { label: 'Matched by name', icon: 'link', hint: 'Their Discord name gives the Roblox username away' },
  noDiscord: { label: 'No Discord account', icon: 'alert' },
  noRoblox: { label: 'No Roblox account', icon: 'alert' },
  left: { label: 'Left the server', icon: 'alert' },
};
export const ACCOUNT_FILTERS = [
  { value: 'missing', label: 'Missing an account', test: (a) => a === 'noDiscord' || a === 'noRoblox' },
  { value: 'noDiscord', label: 'No Discord account', test: (a) => a === 'noDiscord' },
  { value: 'noRoblox', label: 'No Roblox account', test: (a) => a === 'noRoblox' },
  { value: 'linked', label: 'Linked by Bloxlink', test: (a) => a === 'linked' },
  { value: 'matched', label: 'Matched by hand', test: (a) => a === 'matched' },
  { value: 'name', label: 'Matched by name', test: (a) => a === 'name' },
  { value: 'left', label: 'Left the server', test: (a) => a === 'left' },
];

export function statusLabel(p) {
  if (p.game?.online) return 'Playing';
  if (p.inactiveGame && p.inactiveDiscord) return 'Inactive';
  if (p.inactiveGame) return 'Not playing';
  if (p.inactiveDiscord) return 'Quiet';
  if (p.lowChat || p.lowGame) return 'Low activity';
  return 'Active';
}
export const STATUS_TONE = { Playing: 'ok', Active: 'ok', Inactive: 'bad', 'Not playing': 'warn', Quiet: 'warn', 'Low activity': 'warn' };

export const nameOf = (p) => p.discordName ?? p.displayName ?? p.username ?? 'Someone';

/** Everyone once, whichever groups they're in (someone can be a Tester and Staff). */
export function mergePeople(groups) {
  const byKey = new Map();
  for (const g of groups) {
    for (const p of g.people) {
      const key = p.robloxId ? `r${p.robloxId}` : `d${p.discordId}`;
      const have = byKey.get(key);
      if (have) {
        have.groups.push(g.name);
        have.robloxRoles = [...new Set([...have.robloxRoles, ...p.robloxRoles])];
        have.discordRoles = [...new Set([...have.discordRoles, ...p.discordRoles])];
      } else {
        byKey.set(key, { ...p, key, groups: [g.name], account: accountOf(p) });
      }
    }
  }
  // (a group lists someone Discord-only when another group matched their Discord account: fold them in)
  const people = [...byKey.values()];
  const withRoblox = new Map(people.filter((p) => p.robloxId && p.discordId).map((p) => [p.discordId, p]));
  return people.filter((p) => {
    const same = !p.robloxId && withRoblox.get(p.discordId);
    if (!same) return true;
    same.groups = [...new Set([...same.groups, ...p.groups])];
    same.discordRoles = [...new Set([...same.discordRoles, ...p.discordRoles])];
    return false;
  });
}

export const namesOf = (p) => [p.discordName, p.username, p.displayName, p.robloxId && String(p.robloxId), p.discordId];
// (the start of a name to look for look-alikes by: its first run of 3+ letters, "Bea2k_ph" -> "Bea")
export const nameSeed = (s) => (s ?? '').replace(/\(.*$/, '').match(/[A-Za-z]{3,}/)?.[0] ?? '';

/** `list` with the ones named like `name` first. */
export function similarFirst(list, name, names) {
  const word = nameSeed(name);
  if (!word) return list;
  const near = rankByName(list, word, names).map((r) => r.item);
  return [...near, ...list.filter((x) => !near.includes(x))];
}

/** When they were last on Discord: a message or a minute in voice, whichever was later. */
export function lastOnDiscord(p) {
  const times = [p.discord?.lastMessageAt, p.discord?.lastVoiceAt].filter(Boolean).map((t) => new Date(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Why the bot account can't give a Roblox role, or null when it can. */
export function whyNotGivable(admin, role) {
  if (role.assignable) return null;
  if (!admin?.bot.ok) return admin?.bot.configured ? 'the bot account isn’t signed in' : 'no bot account set up';
  return `ranked at or above the bot account (${admin.bot.role.name})`;
}

/** Whether a notice can reach them: a Discord account still in the server. */
export const reachable = (p) => Boolean(p.discordId && p.inServer);
