import { ChannelType, MessageType, PermissionFlagsBits } from 'discord.js';
import { DiscordActivity, DiscordDaily } from '../models/Activity.js';
import { GuildConfig } from '../models/GuildConfig.js';
import { dayKey } from './days.js';

// How members take part on Discord (Team tab, /inactive): when and how much they chat, and time in voice. Only times,
// counts and channels are kept, never the text: messageCreate needs the Guild Messages intent, not Message Content.
// Voice is tallied once a minute from who's in a voice channel (Guild Voice States intent). Everything is buffered and
// written in one go every FLUSH_MS, so a busy server doesn't mean a database write per message.

const FLUSH_MS = 30_000;
const VOICE_TICK_MS = 60_000;
const pending = new Map(); // "guildId:userId" -> { guildId, userId, at, channelId, count, voiceAt }
const pendingDays = new Map(); // "guildId:userId:day" -> { guildId, userId, day, count, replies, channels: Set, voice, voiceWith }
const SCAN_DAYS = 60; // (how far back the history scan reads everything)

function dayBucket(buckets, guildId, userId, at) {
  const day = dayKey(new Date(at));
  const key = `${guildId}:${userId}:${day}`;
  const b = buckets.get(key) ?? { guildId, userId, day, count: 0, replies: 0, channels: new Set(), voice: 0, voiceWith: 0 };
  buckets.set(key, b);
  return b;
}

/** Adds a message to its day's bucket. */
function countDay(buckets, guildId, userId, at, channelId, reply) {
  const b = dayBucket(buckets, guildId, userId, at);
  b.count += 1;
  if (reply) b.replies += 1;
  b.channels.add(channelId);
}

function entryOf(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const entry = pending.get(key) ?? { guildId, userId, at: 0, count: 0, voiceAt: 0 };
  pending.set(key, entry);
  return entry;
}

export function recordMessage(message) {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
  const entry = entryOf(message.guildId, message.author.id);
  entry.count += 1;
  if (message.createdTimestamp > entry.at) {
    entry.at = message.createdTimestamp;
    entry.channelId = message.channelId;
  }
  countDay(pendingDays, message.guildId, message.author.id, message.createdTimestamp, message.channelId, message.type === MessageType.Reply);
}

/**
 * A minute for everyone in a voice channel (not the AFK one). It also counts "with others" when someone else is there
 * and they aren't deafened: sitting alone in a channel, or deafened, isn't talking to the team.
 */
function tallyVoice(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const vs of guild.voiceStates.cache.values()) {
      const member = vs.member;
      if (!vs.channelId || vs.channelId === guild.afkChannelId || !member || member.user.bot) continue;
      const others = vs.channel?.members.filter((m) => !m.user.bot && m.id !== member.id).size ?? 0;
      const b = dayBucket(pendingDays, guild.id, member.id, now);
      b.voice += 1;
      if (others > 0 && !vs.selfDeaf && !vs.serverDeaf) b.voiceWith += 1;
      entryOf(guild.id, member.id).voiceAt = now;
    }
  }
}

/** Writes the buffered activity: the latest times win, the counts add up. */
export async function flushMessages() {
  if (!pending.size && !pendingDays.size) return;
  const entries = [...pending.values()];
  const days = [...pendingDays.values()];
  pending.clear();
  pendingDays.clear();
  if (days.length) {
    await DiscordDaily.bulkWrite(
      days.map((d) => ({
        updateOne: {
          filter: { guildId: d.guildId, userId: d.userId, day: d.day },
          update: {
            $inc: { messages: d.count, replies: d.replies, voiceMinutes: d.voice, voiceWithOthers: d.voiceWith },
            $addToSet: { channels: { $each: [...d.channels] } },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  if (entries.length) {
    await DiscordActivity.bulkWrite(
      entries.map((e) => {
        const max = {};
        if (e.at) max.lastMessageAt = new Date(e.at);
        if (e.voiceAt) max.lastVoiceAt = new Date(e.voiceAt);
        return {
          updateOne: {
            filter: { guildId: e.guildId, userId: e.userId },
            update: { $max: max, $inc: { messages: e.count }, ...(e.channelId ? { $set: { lastChannelId: e.channelId } } : {}) },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }
}

/**
 * Starts the flush loop and the voice tally, notes per server when counting began, and the first time, fills in the
 * last SCAN_DAYS days of chat by itself (the owner, 2026-10-30: "scan the whole chat so the data can be filled for
 * once, since the feature is new").
 */
export function startDiscordActivity(client) {
  setInterval(() => flushMessages().catch((err) => console.error('[team] activity flush failed:', err.message)), FLUSH_MS);
  setInterval(() => tallyVoice(client), VOICE_TICK_MS);
  for (const guild of client.guilds.cache.values()) {
    GuildConfig.updateOne(
      { guildId: guild.id, 'team.discordSince': null },
      { $set: { 'team.discordSince': new Date() } },
    ).catch(() => {});
    GuildConfig.updateOne(
      { guildId: guild.id, 'team.dailySince': null },
      { $set: { 'team.dailySince': new Date() } },
    ).catch(() => {});
    GuildConfig.findOne({ guildId: guild.id, 'team.backfilledAt': { $ne: null } })
      .lean()
      .then((done) => {
        if (done) return;
        console.log(`[team] filling in the last ${SCAN_DAYS} days of chat in ${guild.name} (once)`);
        scanHistory(guild);
      })
      .catch(() => {});
  }
}

// ------------------------------------------------------------------ the history scan
// Reads every channel Wrenchy can see back SCAN_DAYS days (and at least its newest SCAN_MIN messages, for "last message"
// of people who've been quiet longer): the daily counts for those days, and "last message" for everyone it finds.
const SCAN_MIN = 1000;
const SCAN_MAX = 200_000; // (per channel: a stop for runaway channels)
const SCAN_TYPES = [
  ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice,
  ChannelType.PublicThread, ChannelType.AnnouncementThread,
];
export const scans = new Map(); // guildId -> { running, channels, done, messages, startedAt, finishedAt, error, days }

export function scanHistory(guild) {
  const current = scans.get(guild.id);
  if (current?.running) return current;
  const me = guild.members.me;
  const channels = guild.channels.cache.filter(
    (c) =>
      SCAN_TYPES.includes(c.type) &&
      c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );
  const scan = { running: true, channels: channels.size, done: 0, messages: 0, startedAt: new Date(), finishedAt: null, error: null, days: SCAN_DAYS };
  scans.set(guild.id, scan);

  (async () => {
    const latest = new Map(); // userId -> { at, channelId }
    const days = new Map(); // (the daily counts of the last SCAN_DAYS days)
    const from = Date.now() - SCAN_DAYS * 86_400_000;
    for (const channel of channels.values()) {
      let before;
      for (let fetched = 0; fetched < SCAN_MAX; ) {
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
        // (done with this channel once past the window and past its newest SCAN_MIN messages)
        if (batch.size < 100 || (batch.last().createdTimestamp < from && fetched >= SCAN_MIN)) break;
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
    // (a day's count is the larger of what was counted live and what the scan read, so running it again, or while live
    //  counting goes on, never counts a message twice)
    const dayOps = [...days.values()].map((d) => ({
      updateOne: {
        filter: { guildId: d.guildId, userId: d.userId, day: d.day },
        update: { $max: { messages: d.count, replies: d.replies }, $addToSet: { channels: { $each: [...d.channels] } } },
        upsert: true,
      },
    }));
    for (let i = 0; i < dayOps.length; i += 500) await DiscordDaily.bulkWrite(dayOps.slice(i, i + 500), { ordered: false });
    const now = new Date();
    await GuildConfig.updateOne({ guildId: guild.id }, { $set: { 'team.scannedAt': now, 'team.backfilledAt': now } });
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
