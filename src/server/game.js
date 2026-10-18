import crypto from 'node:crypto';
import { EmbedBuilder, escapeMarkdown } from 'discord.js';
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

// Flags from the game's auto-farm watch (ServerScriptService.Modules.AntiCheat). Flag only: the game never punishes
// anyone for them; mods search the username on the in-game admin panel, so no server id is sent.
const FLAG_COLORS = { 3: 0xe04848, 2: 0xf0a030 };

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** One flag as an embed, or null if it doesn't name a real player. */
function flagEmbed(flag, place) {
  const userId = Number(flag?.userId);
  const username = clip(flag?.username, 40);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !username) return null;
  const displayName = clip(flag?.displayName, 40) || username;
  const at = Number(flag?.at);
  return new EmbedBuilder()
    .setColor(FLAG_COLORS[Number(flag?.weight)] ?? FLAG_COLORS[2])
    .setTitle(`🚩 ${clip(flag?.title, 100) || 'Flagged'}`)
    .setURL(`https://www.roblox.com/users/${userId}/profile`)
    .setDescription(clip(flag?.text, 1000) || '-')
    .addFields(
      { name: 'Player', value: escapeMarkdown(`${displayName} (@${username})`), inline: true },
      { name: 'Seen', value: `${Number(flag?.times) || 1}× this session`, inline: true },
      { name: 'Where', value: place, inline: true },
      { name: 'Context', value: clip(flag?.context, 300) || '-' },
    )
    .setFooter({ text: 'Flag only: nothing was done to the player. Search the username on the admin panel.' })
    .setTimestamp(Number.isFinite(at) && at > 0 ? new Date(at * 1000) : new Date());
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

  // The auto-farm watch flagged players on a game server: up to 10 at a time, posted in the flag channel.
  router.post('/flag', async (req, res) => {
    const place = clip(req.body?.place, 20) || 'Live';
    const flags = Array.isArray(req.body?.flags) ? req.body.flags.slice(0, 10) : [];
    const embeds = flags.map((flag) => flagEmbed(flag, place)).filter(Boolean);
    if (!embeds.length) throw new HttpError(400, 'No flags.');

    const channel = await client.channels.fetch(config.flagChannelId).catch(() => null);
    if (!channel?.isTextBased()) throw new HttpError(502, `Can't post in the flag channel (${config.flagChannelId}).`);
    await channel.send({ embeds, allowedMentions: { parse: [] } });
    res.json({ ok: true, posted: embeds.length });
  });

  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('[game] error:', err);
    res.status(500).json({ error: 'Something went wrong on the bot.' });
  });

  return router;
}
