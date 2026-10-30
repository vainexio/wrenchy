import crypto from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { postTicketPanel, refreshTicketPanels } from '../bot/tickets.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { Ticket, TicketCounter } from '../models/Ticket.js';
import { HttpError } from './errors.js';

// The dashboard's Tickets tab: ticket types, panels and settings (saved together, posted panels updated in place),
// posting a panel, the list of tickets and their transcripts. The tickets themselves are run by bot/tickets.js.

const MAX_TYPES = 25; // (a panel shows at most 25: 5 rows of 5 buttons, or 25 dropdown options)
const MAX_PANELS = 10;
const STYLES = ['primary', 'secondary', 'success', 'danger'];
const newId = () => crypto.randomBytes(4).toString('hex');
const P = PermissionFlagsBits;

function text(value, what, max, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new HttpError(400, `${what} must be text.`);
  const t = value.trim();
  if (required && !t) throw new HttpError(400, `${what} can't be empty.`);
  if (t.length > max) throw new HttpError(400, `${what} must be at most ${max} characters.`);
  return t;
}

const isCategory = (guild, id) => guild.channels.cache.get(id)?.type === ChannelType.GuildCategory;
const isText = (guild, id) => guild.channels.cache.get(id)?.isTextBased() && !guild.channels.cache.get(id)?.isThread();
const keepId = (id) => (typeof id === 'string' && /^[a-z0-9]{4,16}$/.test(id) ? id : newId());

export async function ticketsOverview(guild) {
  const gc = await getGuildConfig(guild.id);
  const t = gc.tickets.toObject();
  const [counters, open] = await Promise.all([
    TicketCounter.find({ guildId: guild.id }).lean(),
    Ticket.aggregate([{ $match: { guildId: guild.id, status: 'open' } }, { $group: { _id: '$typeId', n: { $sum: 1 } } }]),
  ]);
  const seq = new Map(counters.map((c) => [c.typeId, c.seq]));
  const openOf = new Map(open.map((o) => [o._id, o.n]));
  const me = guild.members.me;
  return {
    settings: {
      enabled: t.enabled, transcriptChannelId: t.transcriptChannelId, dmTranscript: t.dmTranscript,
      deleteOnClose: t.deleteOnClose !== false, closedCategoryId: t.closedCategoryId,
    },
    types: t.types.map((type) => ({ ...type, nextNumber: (seq.get(type.id) ?? 0) + 1, open: openOf.get(type.id) ?? 0 })),
    panels: t.panels.map((p) => ({
      ...p,
      url: p.channelId && p.messageId ? `https://discord.com/channels/${guild.id}/${p.channelId}/${p.messageId}` : null,
    })),
    categories: guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, channels: c.children.cache.size, canManage: c.permissionsFor(me).has(P.ManageChannels) })),
    bot: {
      manageChannels: me.permissions.has(P.ManageChannels),
      manageRoles: me.permissions.has(P.ManageRoles),
      attachFiles: me.permissions.has(P.AttachFiles),
    },
  };
}

function cleanType(guild, raw, i, seen) {
  const what = `Ticket type ${i + 1}`;
  const name = text(raw?.name, `${what}: name`, 80, { required: true });
  const id = keepId(raw.id);
  if (seen.has(id)) throw new HttpError(400, `${name}: listed twice.`);
  seen.add(id);
  const namePattern = text(raw.namePattern, `${name}: channel names`, 90, { required: true });
  if (!namePattern.includes('{n}')) throw new HttpError(400, `${name}: the channel names need {n}, so each ticket gets its own number.`);
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (questions.length > 5) throw new HttpError(400, `${name}: a form has at most 5 questions.`);
  const maxOpen = Number(raw.maxOpen ?? 1);
  if (!Number.isInteger(maxOpen) || maxOpen < 1 || maxOpen > 10) throw new HttpError(400, `${name}: open tickets per member must be 1 to 10.`);
  if (raw.categoryId && !isCategory(guild, raw.categoryId)) throw new HttpError(400, `${name}: that category no longer exists.`);
  return {
    id,
    name,
    emoji: text(raw.emoji, `${name}: emoji`, 64),
    style: STYLES.includes(raw.style) ? raw.style : 'primary',
    description: text(raw.description, `${name}: description`, 100),
    categoryId: raw.categoryId || null,
    staffRoleIds: [...new Set(Array.isArray(raw.staffRoleIds) ? raw.staffRoleIds : [])].filter((r) => guild.roles.cache.has(r)),
    namePattern,
    welcome: text(raw.welcome, `${name}: welcome message`, 2000),
    questions: questions.map((q, j) => ({
      label: text(q?.label, `${name}: question ${j + 1}`, 45, { required: true }),
      placeholder: text(q.placeholder, `${name}: question ${j + 1} hint`, 100),
      long: Boolean(q.long),
      required: q.required !== false,
    })),
    pingStaff: raw.pingStaff !== false,
    maxOpen,
    nextNumber: raw.nextNumber,
  };
}

/** Saves the ticket types, panels and settings, then updates the posted panels. Returns { warnings }. */
export async function saveTickets(guild, body) {
  const gc = await getGuildConfig(guild.id);
  const t = gc.tickets;
  const s = body?.settings ?? {};
  if (s.transcriptChannelId && !isText(guild, s.transcriptChannelId)) throw new HttpError(400, 'The transcript channel no longer exists.');
  if (s.closedCategoryId && !isCategory(guild, s.closedCategoryId)) throw new HttpError(400, 'The closed tickets category no longer exists.');

  const rawTypes = Array.isArray(body?.types) ? body.types : [];
  if (rawTypes.length > MAX_TYPES) throw new HttpError(400, `At most ${MAX_TYPES} ticket types.`);
  const seen = new Set();
  const types = rawTypes.map((raw, i) => cleanType(guild, raw, i, seen));
  const typeIds = new Set(types.map((x) => x.id));

  const rawPanels = Array.isArray(body?.panels) ? body.panels : [];
  if (rawPanels.length > MAX_PANELS) throw new HttpError(400, `At most ${MAX_PANELS} panels.`);
  const before = new Map(t.panels.map((p) => [p.id, p]));
  const panelIds = new Set();
  const panels = rawPanels.map((raw, i) => {
    const name = text(raw?.name, `Panel ${i + 1}: name`, 60, { required: true });
    const id = keepId(raw.id);
    if (panelIds.has(id)) throw new HttpError(400, `${name}: listed twice.`);
    panelIds.add(id);
    const old = before.get(id);
    return {
      id,
      name,
      // (where it's posted only changes by posting it)
      channelId: old?.channelId ?? null,
      messageId: old?.messageId ?? null,
      title: text(raw.title, `${name}: title`, 256),
      description: text(raw.description, `${name}: message`, 4000),
      color: /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color : '#F08C1A',
      style: raw.style === 'menu' ? 'menu' : 'buttons',
      placeholder: text(raw.placeholder, `${name}: dropdown prompt`, 150),
      typeIds: [...new Set(Array.isArray(raw.typeIds) ? raw.typeIds : [])].filter((x) => typeIds.has(x)).slice(0, 25),
    };
  });

  // (a number to start from: the next ticket of that type gets it)
  const counters = await TicketCounter.find({ guildId: guild.id }).lean();
  const seqOf = new Map(counters.map((c) => [c.typeId, c.seq]));
  for (const type of types) {
    const next = Number(type.nextNumber);
    delete type.nextNumber;
    if (Number.isInteger(next) && next !== (seqOf.get(type.id) ?? 0) + 1) {
      if (next < 1 || next > 999999) throw new HttpError(400, `${type.name}: the next number must be 1 to 999,999.`);
      await TicketCounter.updateOne({ guildId: guild.id, typeId: type.id }, { $set: { seq: next - 1 } }, { upsert: true });
    }
  }

  t.enabled = s.enabled !== false;
  t.transcriptChannelId = s.transcriptChannelId || null;
  t.dmTranscript = s.dmTranscript !== false;
  t.deleteOnClose = s.deleteOnClose !== false;
  t.closedCategoryId = s.closedCategoryId || null;
  t.types = types;
  t.panels = panels;
  gc.markModified('tickets');
  await gc.save();

  // (a panel taken off the dashboard: its posted message goes too, so nobody presses dead buttons)
  for (const old of before.values()) {
    if (panelIds.has(old.id) || !old.channelId || !old.messageId) continue;
    const channel = guild.channels.cache.get(old.channelId);
    await channel?.messages?.delete(old.messageId).catch(() => {});
  }
  const failed = await refreshTicketPanels(guild, gc.tickets);
  return { warnings: failed.map((f) => `Discord refused the posted panel (is every emoji valid?) ${f}`) };
}

/** Posts (or moves) a panel to a channel. */
export async function postPanel(guild, panelId, channelId) {
  const gc = await getGuildConfig(guild.id);
  const panel = gc.tickets.panels.find((p) => p.id === panelId);
  if (!panel) throw new HttpError(404, 'Save the panel first.');
  if (!panel.typeIds.length) throw new HttpError(400, 'Put at least one ticket type on the panel, and save.');
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) throw new HttpError(400, 'Pick a text channel.');
  const missing = channel.permissionsFor(guild.members.me).missing([P.ViewChannel, P.SendMessages, P.EmbedLinks]);
  if (missing.length) throw new HttpError(400, `Wrenchy is missing ${missing.join(', ')} in #${channel.name}.`);
  try {
    await postTicketPanel(guild, gc, panel, channel);
  } catch (err) {
    throw new HttpError(400, `Discord refused the panel (is every emoji valid?): ${err.message}`);
  }
}

/** The tickets, newest first (without their transcripts). */
export async function listTickets(guild) {
  const rows = await Ticket.aggregate([
    { $match: { guildId: guild.id } },
    { $sort: { createdAt: -1 } },
    { $limit: 500 },
    { $addFields: { messages: { $size: '$transcript' } } },
    { $project: { transcript: 0, __v: 0 } },
  ]);
  return rows.map(({ _id, ...t }) => ({
    id: String(_id),
    ...t,
    url: t.status !== 'deleted' && !t.deletedAt ? `https://discord.com/channels/${guild.id}/${t.channelId}` : null,
  }));
}

export async function ticketTranscript(guild, ticketId) {
  const t = await Ticket.findOne({ _id: ticketId, guildId: guild.id }).lean().catch(() => null);
  if (!t) throw new HttpError(404, 'No such ticket.');
  const { _id, __v, ...rest } = t;
  return { id: String(_id), ...rest };
}
