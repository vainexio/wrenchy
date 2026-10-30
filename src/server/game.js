import crypto from 'node:crypto';
import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import express from 'express';
import { config } from '../config.js';
import { PlayerActivity, PlayerDaily } from '../models/Activity.js';
import { dayKey } from '../team/days.js';
import { rememberRoles } from '../roblox/api.js';
import { HttpError } from './errors.js';

// Endpoints the Roblox game server calls: team presence (Modules.TeamActivity) and auto-farm flags (Modules.AntiCheat).
// Authenticated with a shared key in the X-Wrenchy-Key header (the game keeps it in its Secrets Store). (Linking a
// Discord account in the game, /link and /roles, was removed 2026-10-25: Bloxlink links everyone, roblox/verified.js)

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

  // Who of the group is playing (the Team tab: last played, time in game). A game server reports group members (rank
  // 2 and up) as they join, every few minutes while they play ("here", with the minutes since its last report) and as
  // they leave: up to 50 at a time.
  router.post('/presence', async (req, res) => {
    const event = req.body?.event;
    if (!['join', 'here', 'leave'].includes(event)) throw new HttpError(400, 'Bad event.');
    const gameName = clip(req.body?.game, 40);
    const players = Array.isArray(req.body?.players) ? req.body.players.slice(0, 50) : [];
    const now = new Date();
    const day = dayKey(now);
    const ops = [];
    const daily = [];
    for (const raw of players) {
      const userId = Number(raw?.userId);
      const username = clip(raw?.username, 40);
      if (!Number.isSafeInteger(userId) || userId <= 0 || !username) continue;
      const minutes = Math.min(Math.max(Number(raw?.minutes) || 0, 0), 30); // (a report covers 5 minutes at most)
      const set = { username, displayName: clip(raw?.displayName, 40) || username, game: gameName, lastSeenAt: now, online: event !== 'leave' };
      if (event === 'join') set.lastJoinAt = now;
      ops.push({
        updateOne: {
          filter: { robloxId: userId },
          update: { $set: set, $inc: { minutes, sessions: event === 'join' ? 1 : 0 } },
          upsert: true,
        },
      });
      daily.push({
        updateOne: {
          filter: { robloxId: userId, day },
          update: { $inc: { minutes, sessions: event === 'join' ? 1 : 0 } },
          upsert: true,
        },
      });
    }
    if (ops.length) await Promise.all([PlayerActivity.bulkWrite(ops, { ordered: false }), PlayerDaily.bulkWrite(daily, { ordered: false })]);
    res.json({ ok: true, recorded: ops.length });
  });

  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('[game] error:', err);
    res.status(500).json({ error: 'Something went wrong on the bot.' });
  });

  return router;
}
