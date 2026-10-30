import { ChannelType, MessageType, PermissionFlagsBits } from 'discord.js';
import { DiscordActivity, DiscordDaily } from '../models/Activity.js';
import { GuildConfig } from '../models/GuildConfig.js';
import { dayKey } from './days.js';

// When members last sent a message (Team tab, /inactive). Only the time and the channel are kept, never the text:
// messageCreate needs the Guild Messages intent, not Message Content. Messages are buffered and written in one go
// every FLUSH_MS, so a busy chat doesn't mean a database write per message.

const FLUSH_MS = 30_000;
const pending = new Map(); // "guildId:userId" -> { guildId, userId, at, channelId, count }
const pendingDays = new Map(); // "guildId:userId:day" -> { guildId, userId, day, count, replies, channels: Set }
const SCAN_DAYS = 60; // (how far back the history scan fills in the daily counts)

/** Adds a message to its day's bucket. */
function countDay(buckets, guildId, userId, at, channelId, reply) {
  const day = dayKey(new Date(at));
  const key = `${guildId}:${userId}:${day}`;
  const b = buckets.get(key) ?? { guildId, userId, day, count: 0, replies: 0, channels: new Set() };
  b.count += 1;
  if (reply) b.replies += 1;
  b.channels.add(channelId);
  buckets.set(key, b);
}

export function recordMessage(message) {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
  const key = `${message.guildId}:${message.author.id}`;
  const entry = pending.get(key) ?? { guildId: message.guildId, userId: message.author.id, at: 0, count: 0 };
  entry.count += 1;
  if (message.createdTimestamp > entry.at) {
    entry.at = message.createdTimestamp;
    entry.channelId = message.channelId;
  }
  pending.set(key, entry);
  countDay(pendingDays, message.guildId, message.author.id, message.createdTimestamp, message.channelId, message.type === MessageType.Reply);
}

/** Writes the buffered messages: the latest time wins, the counts add up. */
export async function flushMessages() {
  if (!pending.size) return;
  const entries = [...pending.values()];
  const days = [...pendingDays.values()];
  pending.clear();
  pendingDays.clear();
  await DiscordDaily.bulkWrite(
    days.map((d) => ({
      updateOne: {
        filter: { guildId: d.guildId, userId: d.userId, day: d.day },
        update: { $inc: { messages: d.count, replies: d.replies }, $addToSet: { channels: { $each: [...d.channels] } } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  await DiscordActivity.bulkWrite(
    entries.map((e) => ({
      updateOne: {
        filter: { guildId: e.guildId, userId: e.userId },
        update: { $max: { lastMessageAt: new Date(e.at) }, $set: { lastChannelId: e.channelId }, $inc: { messages: e.count } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/** Starts the flush loop and notes, per server, when counting began (shown as "tracking since" on the Team tab). */
export function startDiscordActivity(client) {
  setInterval(() => flushMessages().catch((err) => console.error('[team] message flush failed:', err.message)), FLUSH_MS);
  for (const guild of client.guilds.cache.values()) {
    GuildConfig.updateOne(
      { guildId: guild.id, 'team.discordSince': null },
      { $set: { 'team.discordSince': new Date() } },
    ).catch(() => {});
    GuildConfig.updateOne(
      { guildId: guild.id, 'team.dailySince': null },
      { $set: { 'team.dailySince': new Date() } },
    ).catch(() => {});
  }
}

// ------------------------------------------------------------------ the history scan
// Fills in "last message" for the time before tracking began: the latest messages of every channel Wrenchy can read
// (the newest SCAN_PER_CHANNEL of each). It only ever moves a time later, never adds to the count.
const SCAN_PER_CHANNEL = 1000;
const SCAN_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.PublicThread];
export const scans = new Map(); // guildId -> { running, channels, done, messages, startedAt, finishedAt, error }

export function scanHistory(guild) {
  const current = scans.get(guild.id);
  if (current?.running) return current;
  const me = guild.members.me;
  const channels = guild.channels.cache.filter(
    (c) =>
      SCAN_TYPES.includes(c.type) &&
      c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );
  const scan = { running: true, channels: channels.size, done: 0, messages: 0, startedAt: new Date(), finishedAt: null, error: null };
  scans.set(guild.id, scan);

  (async () => {
    const latest = new Map(); // userId -> { at, channelId }
    const days = new Map(); // (the daily counts of the last SCAN_DAYS days)
    const from = Date.now() - SCAN_DAYS * 86_400_000;
    for (const channel of channels.values()) {
      let before;
      for (let fetched = 0; fetched < SCAN_PER_CHANNEL; ) {
        const batch = await channel.messages.fetch({ limit: 100, before, cache: false }).catch(() => null);
        if (!batch?.size) break;
        for (const m of batch.values()) {
          if (m.author.bot || m.webhookId || m.system) continue;
          const seen = latest.get(m.author.id);
          if (!seen || m.createdTimestamp > seen.at) latest.set(m.author.id, { at: m.createdTimestamp, channelId: m.channelId });
          if (m.createdTimestamp >= from) countDay(days, guild.id, m.author.id, m.createdTimestamp, m.channelId, m.type === MessageType.Reply);
        }
        fetched += batch.size;
        scan.messages += batch.size;
        before = batch.last().id;
        if (batch.size < 100) break;
      }
      scan.done += 1;
    }
    const ops = [...latest].map(([userId, l]) => ({
      updateOne: {
        filter: { guildId: guild.id, userId },
        update: { $max: { lastMessageAt: new Date(l.at) }, $setOnInsert: { lastChannelId: l.channelId } },
        upsert: true,
      },
    }));
    for (let i = 0; i < ops.length; i += 500) await DiscordActivity.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    // (a day's count is the larger of what was counted live and what the scan read: the scan stops at each channel's
    //  newest 1,000 messages, live counting starts whenever Wrenchy came online)
    const dayOps = [...days.values()].map((d) => ({
      updateOne: {
        filter: { guildId: d.guildId, userId: d.userId, day: d.day },
        update: { $max: { messages: d.count, replies: d.replies }, $addToSet: { channels: { $each: [...d.channels] } } },
        upsert: true,
      },
    }));
    for (let i = 0; i < dayOps.length; i += 500) await DiscordDaily.bulkWrite(dayOps.slice(i, i + 500), { ordered: false });
    await GuildConfig.updateOne({ guildId: guild.id }, { $set: { 'team.scannedAt': new Date() } });
    console.log(`[team] scanned ${scan.messages} messages in ${scan.channels} channels of ${guild.name}: ${latest.size} people`);
  })()
    .catch((err) => {
      scan.error = err.message;
      console.error('[team] history scan failed:', err);
    })
    .finally(() => {
      scan.running = false;
      scan.finishedAt = new Date();
    });
  return scan;
}
