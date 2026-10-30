import { config } from '../config.js';

// The studio's Roblox bot account ranks people in the group for the Team tab: adding team members, changing their
// role, suspending and removing them. It signs in with its .ROBLOSECURITY cookie (ROBLOX_COOKIE, set on the host: never
// in the code). Roblox's web API also wants a CSRF token, which it hands out on the first request it refuses.
// The bot account can only change roles ranked below its own, and needs the group's "manage members" permission.

const API_TIMEOUT_MS = 10_000;
let csrfToken = null;

export class RobloxBotError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function explain(status, robloxMessage) {
  if (status === 401) return 'The Roblox bot account is signed out (its cookie expired). Put a fresh ROBLOX_COOKIE on the host.';
  if (status === 403) return `The Roblox bot account isn't allowed to do that: it needs a higher rank than the role, with permission to manage members. (${robloxMessage})`;
  return robloxMessage || `Roblox said no (${status}).`;
}

/** A request as the bot account: JSON in, JSON out. Throws RobloxBotError with a message fit for the dashboard. */
async function call(method, url, body) {
  if (!config.robloxCookie) throw new RobloxBotError(0, 'No Roblox bot account yet: put its cookie in ROBLOX_COOKIE on the host.');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(url, {
      method,
      headers: {
        Cookie: `.ROBLOSECURITY=${config.robloxCookie}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    // (the first write of a session is refused with a fresh token: retry once with it)
    const token = res.headers.get('x-csrf-token');
    if (res.status === 403 && token && token !== csrfToken && attempt === 0) {
      csrfToken = token;
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new RobloxBotError(res.status, explain(res.status, data.errors?.[0]?.message));
    return data;
  }
  throw new RobloxBotError(403, 'Roblox kept refusing the request.');
}

let accountCache = null; // { at, account }
const ACCOUNT_TTL_MS = 5 * 60 * 1000;

/** The bot account: { id, name, displayName }. */
export async function botAccount() {
  if (accountCache && Date.now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.account;
  const data = await call('GET', 'https://users.roblox.com/v1/users/authenticated');
  const account = { id: data.id, name: data.name, displayName: data.displayName };
  accountCache = { at: Date.now(), account };
  return account;
}

/** Someone's role in the group ({ id, name, rank }), or null when they're not in it. Public: no cookie needed. */
export async function groupRoleOf(groupId, userId) {
  const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new RobloxBotError(res.status, `Roblox couldn't say which groups that account is in (${res.status}).`);
  const entry = (await res.json()).data?.find((d) => d.group.id === Number(groupId));
  return entry ? { id: entry.role.id, name: entry.role.name, rank: entry.role.rank } : null;
}

/**
 * Whether the bot account works, and how far it reaches: { configured, ok, account, role, error }. role is its own
 * role in the group: it can give and take roles ranked below role.rank.
 */
export async function botStatus(groupId) {
  if (!config.robloxCookie) return { configured: false, ok: false, account: null, role: null, error: null };
  try {
    const account = await botAccount();
    const role = await groupRoleOf(groupId, account.id);
    return { configured: true, ok: Boolean(role), account, role, error: role ? null : 'The bot account isn’t in the group.' };
  } catch (err) {
    return { configured: true, ok: false, account: null, role: null, error: err.message };
  }
}

/** Gives someone a role in the group (their only role: Roblox groups give one each). */
export async function setGroupRole(groupId, userId, roleId) {
  await call('PATCH', `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, { roleId: Number(roleId) });
}

/** Accepts someone's request to join the group (adding a new team member who asked to join). */
export async function acceptJoinRequest(groupId, userId) {
  await call('POST', `https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${userId}`);
}
