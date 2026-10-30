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
const ROLE_MEMBERS_STALE_MS = 60 * 60 * 1000; // (older than this, wait for a fresh list)
const roleMembersCache = new Map(); // roleId -> { at, users }
const roleMembersLoading = new Map(); // roleId -> the request going on

/**
 * Everyone holding a group role: [{ robloxId, username, displayName }]. Cached for 10 minutes; after that the cached
 * list is still answered (up to an hour old) while a fresh one loads in the background, so pages don't wait on Roblox.
 * fresh = ask Roblox now and wait (/update, after a rank change). The Team tab, and each linked member's roles.
 */
export async function getRoleMembers(groupId, roleId, { fresh = false } = {}) {
  const cached = roleMembersCache.get(roleId);
  const age = cached ? Date.now() - cached.at : Infinity;
  if (!fresh && age < ROLE_MEMBERS_TTL_MS) return cached.users;
  let loading = roleMembersLoading.get(roleId);
  if (!loading) {
    loading = loadRoleMembers(groupId, roleId).finally(() => roleMembersLoading.delete(roleId));
    roleMembersLoading.set(roleId, loading);
  }
  if (!fresh && age < ROLE_MEMBERS_STALE_MS) {
    loading.catch((err) => console.error(`[roblox] refreshing role ${roleId} failed:`, err.message));
    return cached.users;
  }
  return loading;
}

async function loadRoleMembers(groupId, roleId) {
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

/** A Roblox account by id: { robloxId, username, displayName }, or null if there's none. */
export async function getRobloxUser(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Roblox API ${res.status} for user ${userId}`);
  const u = await res.json();
  return { robloxId: u.id, username: u.name, displayName: u.displayName };
}

/** Forgets cached role member lists (after the bot account changes someone's role). */
export function forgetRoleMembers() {
  roleMembersCache.clear();
  roleMembersLoading.clear(); // (a list being loaded may be from before the change)
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
