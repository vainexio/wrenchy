import crypto from 'node:crypto';
import express from 'express';
import { notifyLinked } from '../bot/interactions/linkButton.js';
import { config } from '../config.js';
import { LinkCode } from '../models/LinkCode.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { rememberRoles } from '../roblox/api.js';
import { syncEverywhere } from '../roblox/sync.js';
import { HttpError } from './errors.js';

// Endpoints the Roblox game server calls (ServerScriptService.Modules.DiscordLink). Authenticated with a shared key
// in the X-Wrenchy-Key header (the game keeps it in its Secrets Store). The game decides who may link (staff only)
// and vouches for the player's identity: Roblox tells the game server who each player is.

export const gameStatus = { lastSeenAt: null };

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireGameKey(req, _res, next) {
  if (!config.gameApiKey) throw new HttpError(503, 'GAME_API_KEY is not set on the bot.');
  const key = req.get('x-wrenchy-key') ?? '';
  if (!safeEqual(key, config.gameApiKey)) throw new HttpError(401, 'Bad game key.');
  gameStatus.lastSeenAt = new Date();
  next();
}

/** Validates the player block every game request carries. */
function readPlayer(body) {
  const userId = Number(body?.userId);
  const username = typeof body?.username === 'string' ? body.username.slice(0, 40) : '';
  if (!Number.isSafeInteger(userId) || userId <= 0 || !username) throw new HttpError(400, 'Bad player.');
  const roles = Array.isArray(body.roles) ? body.roles : [];
  return {
    robloxId: userId,
    username,
    displayName: typeof body.displayName === 'string' ? body.displayName.slice(0, 40) : username,
    roles: roles
      .slice(0, 50)
      .map((r) => ({ id: Number(r?.id), name: String(r?.name ?? '').slice(0, 100), rank: Number(r?.rank) }))
      .filter((r) => Number.isSafeInteger(r.id) && Number.isFinite(r.rank) && r.rank > 0),
  };
}

export function createGameRouter(client) {
  const router = express.Router();
  router.use(requireGameKey);

  // (every report teaches the bot the group's private roles too)
  router.use((req, _res, next) => {
    const roles = Array.isArray(req.body?.roles) ? readPlayer(req.body).roles : [];
    rememberRoles(config.defaultRobloxGroupId, roles).catch((err) => console.error('[game] remember roles:', err.message));
    next();
  });

  // A staff member typed /link CODE in game.
  router.post('/link', async (req, res) => {
    const player = readPlayer(req.body);
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const entry = code && (await LinkCode.findOneAndDelete({ code, expiresAt: { $gt: new Date() } }));
    if (!entry) throw new HttpError(404, 'That code is wrong or expired. Get a new one in Discord.');

    // One Roblox account per Discord account and back: drop whatever either side was linked to before.
    const replaced = await RobloxLink.find({
      $or: [{ discordId: entry.discordId }, { robloxId: player.robloxId }],
    });
    await RobloxLink.deleteMany({ _id: { $in: replaced.map((l) => l._id) } });
    for (const old of replaced.filter((l) => l.discordId !== entry.discordId)) {
      await syncEverywhere(client, old.discordId, null); // (that other Discord account loses the roles)
    }

    const link = await RobloxLink.create({
      discordId: entry.discordId,
      ...player,
      rolesFrom: 'game',
      rolesAt: new Date(),
    });
    await syncEverywhere(client, link.discordId, link);
    await notifyLinked(code, link);

    const user = await client.users.fetch(link.discordId).catch(() => null);
    console.log(`[roblox] @${link.username} (${link.robloxId}) linked to ${user?.tag ?? link.discordId}`);
    res.json({ ok: true, discordName: user ? user.globalName || user.username : 'your Discord account' });
  });

  // A staff member joined a game server: their full set of group roles, so Discord can follow promotions.
  router.post('/roles', async (req, res) => {
    const player = readPlayer(req.body);
    const link = await RobloxLink.findOne({ robloxId: player.robloxId });
    if (!link) return res.json({ linked: false });

    Object.assign(link, player, { rolesFrom: 'game', rolesAt: new Date() });
    await link.save();
    await syncEverywhere(client, link.discordId, link);
    res.json({ linked: true });
  });

  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('[game] error:', err);
    res.status(500).json({ error: 'Something went wrong on the bot.' });
  });

  return router;
}
