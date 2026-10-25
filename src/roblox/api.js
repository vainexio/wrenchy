import { RobloxRole } from '../models/RobloxRole.js';

// Public Roblox web APIs (no key needed).
const GROUP_ROLES_TTL_MS = 10 * 60 * 1000;
const groupRolesCache = new Map(); // groupId -> { at, roles }

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Roblox API ${res.status} for ${url}`);
  return res.json();
}

/** Every role in the group: [{ id, name, rank }], highest rank first. Cached for 10 minutes. */
export async function getGroupRoles(groupId) {
  const cached = groupRolesCache.get(groupId);
  if (cached && Date.now() - cached.at < GROUP_ROLES_TTL_MS) return cached.roles;
  const data = await getJson(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
  const roles = data.roles
    .filter((r) => r.rank > 0) // (Guest)
    .map((r) => ({ id: r.id, name: r.name, rank: r.rank }))
    .sort((a, b) => b.rank - a.rank);
  groupRolesCache.set(groupId, { at: Date.now(), roles });
  return roles;
}

// (A member's own roles: Roblox's per-user API, /v2/users/{id}/groups/roles, gives only the HIGHEST one of members
// who hold several. Each role's member list below lists them under every role they hold, so roles come from those.)
const ROLE_MEMBERS_TTL_MS = 10 * 60 * 1000;
const roleMembersCache = new Map(); // roleId -> { at, users }

/**
 * Everyone holding a group role: [{ robloxId, username, displayName }]. Cached for 10 minutes; fresh = ask Roblox
 * now (/update). The Team tab, and each linked member's roles (roblox/sync.js).
 */
export async function getRoleMembers(groupId, roleId, { fresh = false } = {}) {
  const cached = roleMembersCache.get(roleId);
  if (!fresh && cached && Date.now() - cached.at < ROLE_MEMBERS_TTL_MS) return cached.users;
  const users = [];
  let cursor = '';
  for (let page = 0; page < 50; page += 1) {
    const data = await getJson(
      `https://groups.roblox.com/v1/groups/${groupId}/roles/${roleId}/users?limit=100&sortOrder=Asc${cursor ? `&cursor=${cursor}` : ''}`,
    );
    for (const u of data.data ?? []) users.push({ robloxId: u.userId, username: u.username, displayName: u.displayName });
    if (!data.nextPageCursor) break;
    cursor = encodeURIComponent(data.nextPageCursor);
  }
  roleMembersCache.set(roleId, { at: Date.now(), users });
  return users;
}

/**
 * Roblox accounts by username, up to 100 per request: Map(lowercased username -> { robloxId, username,
 * displayName }). Names Roblox doesn't know (or banned accounts) are missing from it.
 */
export async function resolveUsernames(usernames) {
  const found = new Map();
  const unique = [...new Set(usernames.map((u) => u.toLowerCase()))];
  for (let i = 0; i < unique.length; i += 100) {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: unique.slice(i, i + 100), excludeBannedUsers: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Roblox API ${res.status} for usernames`);
    for (const u of (await res.json()).data ?? []) {
      found.set(u.requestedUsername.toLowerCase(), { robloxId: u.id, username: u.name, displayName: u.displayName });
    }
  }
  return found;
}

/** Remembers roles the game reported (private ones included), so the dashboard can offer them. */
export async function rememberRoles(groupId, roles) {
  await Promise.all(
    roles.map((r) =>
      RobloxRole.updateOne(
        { groupId, roleId: r.id },
        { $set: { name: r.name, rank: r.rank } },
        { upsert: true },
      ),
    ),
  );
}

/** Public roles + every role the game has reported, highest rank first: [{ id, name, rank, hidden }]. */
export async function getKnownGroupRoles(groupId) {
  const [publicRoles, seen] = await Promise.all([
    getGroupRoles(groupId).catch(() => []),
    RobloxRole.find({ groupId }).lean(),
  ]);
  const byId = new Map(publicRoles.map((r) => [r.id, { ...r, hidden: false }]));
  for (const r of seen) {
    if (!byId.has(r.roleId)) byId.set(r.roleId, { id: r.roleId, name: r.name, rank: r.rank, hidden: true });
  }
  return [...byId.values()].sort((a, b) => b.rank - a.rank);
}
