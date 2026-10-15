import crypto from 'node:crypto';
import { config } from '../config.js';

// Dashboard login via Discord OAuth2. Only members holding config.adminRoleId
// (in whichever server the bot shares with them that has that role) get in.

const SESSION_COOKIE = 'wrenchy_session';
const STATE_COOKIE = 'wrenchy_oauth_state';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DISCORD_API = 'https://discord.com/api/v10';

const redirectUri = () => `${config.publicUrl}/api/auth/callback`;

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function encodeSession(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decodeSession(token) {
  const [payload, signature] = (token ?? '').split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const cookieOptions = (req, maxAge) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: req.secure,
  path: '/',
  maxAge,
});

/** Returns the guild member with the admin role, or null. Always asks Discord so role removals apply immediately. */
async function findAdminMember(discordClient, userId) {
  const guild = discordClient.guilds.cache.find((g) => g.roles.cache.has(config.adminRoleId));
  if (!guild) return null;
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  return member?.roles.cache.has(config.adminRoleId) ? member : null;
}

function loginError(res, code) {
  res.clearCookie(STATE_COOKIE, { path: '/' });
  res.redirect(`/?error=${code}`);
}

export function createAuthRoutes(discordClient) {
  const configured = () => Boolean(config.clientSecret && config.sessionSecret);

  return {
    start(req, res) {
      if (!configured() || !discordClient.isReady()) return loginError(res, 'not_configured');
      const state = crypto.randomBytes(16).toString('base64url');
      res.cookie(STATE_COOKIE, state, cookieOptions(req, 10 * 60 * 1000));
      const params = new URLSearchParams({
        client_id: discordClient.user.id,
        response_type: 'code',
        scope: 'identify',
        redirect_uri: redirectUri(),
        state,
      });
      res.redirect(`https://discord.com/oauth2/authorize?${params}`);
    },

    async callback(req, res) {
      const { code, state } = req.query;
      const expectedState = readCookie(req, STATE_COOKIE);
      if (!configured() || !discordClient.isReady()) return loginError(res, 'not_configured');
      if (typeof code !== 'string' || !expectedState || state !== expectedState) return loginError(res, 'invalid_state');

      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: discordClient.user.id,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(),
        }),
      });
      if (!tokenRes.ok) {
        console.error('[auth] token exchange failed:', tokenRes.status, await tokenRes.text());
        return loginError(res, 'oauth_failed');
      }
      const { access_token: accessToken } = await tokenRes.json();

      const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!userRes.ok) return loginError(res, 'oauth_failed');
      const user = await userRes.json();

      if (!(await findAdminMember(discordClient, user.id))) {
        console.warn(`[auth] denied dashboard login for ${user.username} (${user.id})`);
        return loginError(res, 'forbidden');
      }

      const avatar = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;
      const session = { id: user.id, name: user.global_name || user.username, avatar };

      console.log(`[auth] ${user.username} (${user.id}) logged in to the dashboard`);
      res.clearCookie(STATE_COOKIE, { path: '/' });
      res.cookie(SESSION_COOKIE, encodeSession(session), cookieOptions(req, SESSION_TTL_MS));
      res.redirect('/');
    },

    logout(_req, res) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ ok: true });
    },

    me(req, res) {
      res.json(req.user);
    },

    async requireAuth(req, res, next) {
      const session = configured() ? decodeSession(readCookie(req, SESSION_COOKIE)) : null;
      if (!session) return res.status(401).json({ error: 'Please log in.' });
      if (!discordClient.isReady()) return res.status(503).json({ error: 'The bot is not connected to Discord yet.' });
      if (!(await findAdminMember(discordClient, session.id))) {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return res.status(403).json({ error: "You no longer have the role needed to use the dashboard." });
      }
      req.user = { id: session.id, name: session.name, avatar: session.avatar };
      next();
    },
  };
}
