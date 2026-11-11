import { MessageFlags } from 'discord.js';
import { Sticky } from '../models/Sticky.js';

// STICKY MESSAGES (the owner, 2026-11-11: "a /sticky command so i can sticky a message abt bans"). A channel's sticky
// is kept as its LAST message: whenever anything else is posted there (a member, another bot, Wrenchy's own ban
// posts), a new copy goes up at the bottom and the old copy comes down. Several posts in a row (a batch of bans) move
// it once, QUIET_MS after the last of them, and never later than MAX_WAIT_MS after the first.
// A copy never pings anyone (no mentions allowed, sent silently): it's reposted all day.
// The bot only needs to know THAT a message was posted (Guild Messages intent), never its text.

export const STICKY_PREFIX = 'sticky:';
export const STICKY_MAX = 2000; // (a Discord message's limit)
const QUIET_MS = 3000;
const MAX_WAIT_MS = 15000;

const stickies = new Map(); // channel id -> { content, messageId }
const timers = new Map(); // channel id -> { timeout, since }
const busy = new Set(); // channels being reposted in right now

function payload(content) {
  return { content, allowedMentions: { parse: [] }, flags: MessageFlags.SuppressNotifications };
}

/** The sticky text of a channel, or null. */
export function stickyIn(channelId) {
  return stickies.get(channelId)?.content ?? null;
}

// (force: the bot KNOWS something was posted after the sticky, so the "is it last already?" look is skipped)
function schedule(client, channelId, { wait, force = false } = {}) {
  const now = Date.now();
  const t = timers.get(channelId) ?? { since: now, force: false };
  clearTimeout(t.timeout);
  t.force = t.force || force;
  const delay = wait ?? Math.max(0, Math.min(QUIET_MS, t.since + MAX_WAIT_MS - now));
  t.timeout = setTimeout(() => {
    timers.delete(channelId);
    bump(client, channelId, t.force);
  }, delay);
  timers.set(channelId, t);
}

/** Puts the channel's sticky back at the bottom, unless it's there already. */
async function bump(client, channelId, force = false) {
  const s = stickies.get(channelId);
  if (!s) return;
  if (busy.has(channelId)) {
    schedule(client, channelId, { wait: 1000, force }); // (a repost is under way: look again once it's done)
    return;
  }
  busy.add(channelId);
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    if (!force && s.messageId && channel.lastMessageId === s.messageId) return;
    const old = s.messageId;
    const message = await channel.send(payload(s.content));
    if (stickies.get(channelId) !== s) {
      // (removed or rewritten while this copy was on its way)
      await channel.messages.delete(message.id).catch(() => null);
      return;
    }
    s.messageId = message.id;
    await Sticky.updateOne({ channelId }, { $set: { messageId: message.id } });
    if (old) await channel.messages.delete(old).catch(() => null);
  } catch (err) {
    console.error(`[sticky] couldn't repost in ${channelId}:`, err.message);
  } finally {
    busy.delete(channelId);
  }
}

/** Something was posted: if the channel has a sticky and this isn't it, the sticky moves down in a moment. */
export function onStickyMessage(message) {
  const s = stickies.get(message.channelId);
  if (!s || message.id === s.messageId) return;
  schedule(message.client, message.channelId);
}

/** Wrenchy itself just posted in this channel (the ban log): the same, without waiting to hear about its own post. */
export function nudgeSticky(client, channelId) {
  if (stickies.has(channelId)) schedule(client, channelId, { force: true });
}

/** The sticky's copy was deleted by hand: it comes back (/sticky remove is how it goes for good). */
export function onStickyDelete(message) {
  const s = stickies.get(message.channelId);
  if (!s || message.id !== s.messageId) return;
  s.messageId = null;
  schedule(message.client, message.channelId);
}

/** The channel is gone: so is its sticky. */
export function forgetSticky(channelId) {
  if (!stickies.delete(channelId)) return;
  clearTimeout(timers.get(channelId)?.timeout);
  timers.delete(channelId);
  Sticky.deleteOne({ channelId }).catch(() => {});
}

/** Writes (or rewrites) a channel's sticky and posts it now. Throws if the bot can't post there. */
export async function setSticky(channel, content, userId) {
  const old = stickies.get(channel.id);
  const message = await channel.send(payload(content));
  stickies.set(channel.id, { content, messageId: message.id });
  await Sticky.findOneAndUpdate(
    { channelId: channel.id },
    { $set: { guildId: channel.guildId, content, messageId: message.id, setBy: userId } },
    { upsert: true },
  );
  if (old?.messageId) await channel.messages.delete(old.messageId).catch(() => null);
}

/** Takes a channel's sticky down for good. False if it had none. */
export async function removeSticky(channel) {
  const s = stickies.get(channel.id);
  if (!s) return false;
  stickies.delete(channel.id);
  clearTimeout(timers.get(channel.id)?.timeout);
  timers.delete(channel.id);
  await Sticky.deleteOne({ channelId: channel.id });
  if (s.messageId) await channel.messages.delete(s.messageId).catch(() => null);
  return true;
}

/** At startup: every saved sticky, and any that isn't last any more (posts made while the bot was down) moves down. */
export async function loadStickies(client) {
  const docs = await Sticky.find();
  for (const doc of docs) {
    stickies.set(doc.channelId, { content: doc.content, messageId: doc.messageId });
    await bump(client, doc.channelId);
  }
  if (docs.length) console.log(`[sticky] ${docs.length} sticky message(s) loaded`);
}
