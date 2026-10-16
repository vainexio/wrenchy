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

/**
 * The member's HIGHEST role in the group ({ id, name, rank }), or null if they're not in it.
 * (Roblox's web API only returns the highest role of members who hold several.)
 */
export async function getUserTopRole(userId, groupId) {
  const data = await getJson(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
  const entry = data.data?.find((d) => d.group?.id === groupId);
  return entry ? { id: entry.role.id, name: entry.role.name, rank: entry.role.rank } : null;
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
