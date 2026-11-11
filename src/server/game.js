import crypto from 'node:crypto';
import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import express from 'express';
import { config } from '../config.js';
import { PlayerActivity, PlayerDaily } from '../models/Activity.js';
import { PublicBan } from '../models/PublicBan.js';
import { dayKey } from '../team/days.js';
import { rememberRoles } from '../roblox/api.js';
import { HttpError } from './errors.js';

// Endpoints the Roblox game server calls: team presence (Modules.TeamActivity), auto-farm flags (Modules.AntiCheat) and
// the public ban log (Modules.PublicBans).
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

// THE PUBLIC BAN LOG. The game reports each ban (the admin panel's, and the anti-cheat's own) with a BROAD reason
// ("Exploiting"), never the moderator's words and never who banned: the post is for everyone to read.
const BAN_COLOR = 0xd04a4a;

/** One reported ban, checked, or null if it doesn't name a real player. */
function readBan(raw) {
  const robloxId = Number(raw?.userId);
  const username = clip(raw?.username, 40);
  if (!Number.isSafeInteger(robloxId) || robloxId <= 0 || !username) return null;
  const seconds = Number(raw?.seconds);
  const at = Number(raw?.at);
  return {
    robloxId,
    username,
    displayName: clip(raw?.displayName, 40) || username,
    // (one line, short: the game sends a category, and nothing longer is ever shown)
    reason: clip(raw?.reason, 60).replace(/\s+/g, ' ').trim() || 'Breaking the game rules',
    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : -1,
    bannedAt: Number.isFinite(at) && at > 0 ? new Date(at * 1000) : new Date(),
  };
}

function banLength(seconds) {
  if (seconds < 0) return 'Permanent';
  const days = Math.round(seconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function banEmbed(ban, gameName) {
  const who = ban.displayName === ban.username ? `@${ban.username}` : `${ban.displayName} (@${ban.username})`;
  return new EmbedBuilder()
    .setColor(BAN_COLOR)
    .setTitle('🔨 Player banned')
    .setURL(`https://www.roblox.com/users/${ban.robloxId}/profile`)
    .addFields(
      { name: 'Player', value: escapeMarkdown(who), inline: true },
      { name: 'Reason', value: escapeMarkdown(ban.reason), inline: true },
      { name: 'Length', value: banLength(ban.seconds), inline: true },
    )
    .setFooter({ text: gameName })
    .setTimestamp(ban.bannedAt);
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

  // Bans, for the public ban channel: up to 10 at a time. One post per player while their ban stands: a second report
  // (the game retrying, a new length) edits that post in place.
  router.post('/ban', async (req, res) => {
    const gameName = clip(req.body?.game, 40) || 'Mangingisda';
    const bans = (Array.isArray(req.body?.bans) ? req.body.bans.slice(0, 10) : []).map(readBan).filter(Boolean);
    if (!bans.length) throw new HttpError(400, 'No bans.');

    const channel = await client.channels.fetch(config.banChannelId).catch(() => null);
    if (!channel?.isTextBased()) throw new HttpError(502, `Can't post in the ban channel (${config.banChannelId}).`);

    let posted = 0;
    for (const ban of bans) {
      const embed = banEmbed(ban, gameName);
      const open = await PublicBan.findOne({ robloxId: ban.robloxId, liftedAt: null });
      let message = null;
      if (open?.messageId && open.channelId === channel.id) {
        message = await channel.messages.edit(open.messageId, { embeds: [embed] }).catch(() => null);
      }
      if (!message) message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await PublicBan.findOneAndUpdate(
        { robloxId: ban.robloxId, liftedAt: null },
        { $set: { ...ban, game: gameName, channelId: channel.id, messageId: message.id } },
        { upsert: true },
      );
      posted += 1;
    }
    res.json({ ok: true, posted });
  });

  // Unbans: the player's public post comes down (a ban that was lifted, or made by mistake, shouldn't stay up).
  router.post('/unban', async (req, res) => {
    const ids = (Array.isArray(req.body?.userIds) ? req.body.userIds.slice(0, 20) : [])
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!ids.length) throw new HttpError(400, 'No players.');

    let removed = 0;
    for (const robloxId of ids) {
      const open = await PublicBan.findOne({ robloxId, liftedAt: null });
      if (!open) continue;
      const channel = open.channelId ? await client.channels.fetch(open.channelId).catch(() => null) : null;
      if (channel?.isTextBased() && open.messageId) await channel.messages.delete(open.messageId).catch(() => null);
      open.liftedAt = new Date();
      await open.save();
      removed += 1;
    }
    res.json({ ok: true, removed });
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
