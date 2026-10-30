import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder,
  OverwriteType, PermissionFlagsBits, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { Ticket, TicketCounter } from '../models/Ticket.js';
import { slug, ticketName } from '../shared/ticketName.js';

// TICKETS (the owner, 2026-10-30): panels of buttons or a dropdown, one per kind of ticket ("Content creator
// application", "Player report"...). Picking one (after a short form, if the type asks questions) opens a private channel
// in that type's category, named by its pattern (cc-apps-0001), for the member and the type's staff roles. In it:
// Close (with a reason), Claim, Add user, Transcript; once closed: Reopen, Transcript, Delete. Closing saves a transcript,
// posts it in the transcript channel and DMs it to the member. /ticket does the same from the keyboard.
//
// Message text in transcripts needs the Message Content intent turned on in the Developer Portal (Bot → Privileged
// Gateway Intents): without it Discord hands bots empty messages. Wrenchy doesn't ask for the intent at login, so the
// activity tracking still never receives anyone's text.

export const TICKET_PREFIX = 'ticket:';
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const ACCENT = 0xf08c1a;
const P = PermissionFlagsBits;
const MEMBER_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const STAFF_ALLOW = [...MEMBER_ALLOW, P.ManageMessages];
const BOT_ALLOW = [...STAFF_ALLOW, P.ManageChannels];
const TRANSCRIPT_MAX = 5000;
// (a user's permissions by id: said outright, or discord.js wants them cached to tell users from roles)
const AS_MEMBER = { type: OverwriteType.Member };
const DELETE_DELAY_MS = 5000;

/** A problem to tell the member, not a bug. */
export class TicketError extends Error {}

const colorOf = (hex) => (/^#[0-9a-f]{6}$/i.test(hex ?? '') ? parseInt(hex.slice(1), 16) : ACCENT);
const fill = (text, member) => (text ?? '').replaceAll('{user}', `${member}`);

// ------------------------------------------------------------------ panels
/** A panel's message: its embed, and a button per ticket type (or one dropdown). */
export function buildTicketPanel(tickets, panel) {
  const types = panel.typeIds.map((id) => tickets.types.find((t) => t.id === id)).filter(Boolean);
  const embed = new EmbedBuilder().setColor(colorOf(panel.color));
  if (panel.title) embed.setTitle(panel.title);
  if (panel.description) embed.setDescription(panel.description);
  if (!panel.title && !panel.description) embed.setDescription('Open a ticket');
  const components = [];
  if (types.length && panel.style === 'menu') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${TICKET_PREFIX}menu:${panel.id}`)
      .setPlaceholder(panel.placeholder || 'Open a ticket…')
      .setDisabled(!tickets.enabled)
      .addOptions(
        types.map((t) => {
          const option = { label: t.name.slice(0, 100), value: t.id };
          if (t.description) option.description = t.description.slice(0, 100);
          if (t.emoji) option.emoji = t.emoji;
          return option;
        }),
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  } else if (types.length) {
    const buttons = types.map((t) => {
      const b = new ButtonBuilder()
        .setCustomId(`${TICKET_PREFIX}open:${t.id}`)
        .setLabel(t.name.slice(0, 80))
        .setStyle(STYLES[t.style] ?? ButtonStyle.Primary)
        .setDisabled(!tickets.enabled);
      if (t.emoji) b.setEmoji(t.emoji);
      return b;
    });
    for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return { content: '', embeds: [embed], components };
}

async function panelMessage(guild, panel) {
  if (!panel.channelId || !panel.messageId) return null;
  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  return channel?.isTextBased() ? channel.messages.fetch(panel.messageId).catch(() => null) : null;
}

/** Edits every posted panel in place (after the dashboard saves). Returns the panels Discord refused, by name. */
export async function refreshTicketPanels(guild, tickets) {
  const failed = [];
  for (const panel of tickets.panels) {
    const message = await panelMessage(guild, panel);
    if (message) await message.edit(buildTicketPanel(tickets, panel)).catch((err) => failed.push(`${panel.name}: ${err.message}`));
  }
  return failed;
}

/** Posts a panel in `channel` (removing it from where it was) and saves where it is. */
export async function postTicketPanel(guild, guildConfig, panel, channel) {
  const old = await panelMessage(guild, panel);
  const message = await channel.send(buildTicketPanel(guildConfig.tickets, panel));
  if (old) await old.delete().catch(() => {});
  panel.channelId = channel.id;
  panel.messageId = message.id;
  guildConfig.markModified('tickets.panels');
  await guildConfig.save();
  return message;
}

// ------------------------------------------------------------------ who may do what
export function isStaff(member, type) {
  if (member.permissions.has(P.ManageChannels)) return true;
  return Boolean(type?.staffRoleIds.some((id) => member.roles.cache.has(id)));
}

/** The ticket this channel is, and its type (as it's set up now). */
export async function ticketIn(channel) {
  const ticket = await Ticket.findOne({ channelId: channel.id, status: { $ne: 'deleted' } });
  if (!ticket) return null;
  const gc = await getGuildConfig(channel.guild.id);
  return { ticket, type: gc.tickets.types.find((t) => t.id === ticket.typeId) ?? null, gc };
}

function mustBeStaff(member, type) {
  if (!isStaff(member, type)) throw new TicketError('Only staff can do that.');
}

function mustBeOpenerOrStaff(member, ticket, type) {
  if (member.id !== ticket.openerId && !isStaff(member, type)) throw new TicketError('Only staff or whoever opened this ticket can do that.');
}

// ------------------------------------------------------------------ opening
/** Their open tickets of a type (any whose channel is gone are marked deleted). */
async function openTicketsOf(guild, userId, typeId) {
  const open = await Ticket.find({ guildId: guild.id, openerId: userId, typeId, status: 'open' });
  const alive = [];
  for (const t of open) {
    if (guild.channels.cache.has(t.channelId)) alive.push(t);
    else await Ticket.updateOne({ _id: t._id }, { $set: { status: 'deleted', deletedAt: new Date() } });
  }
  return alive;
}

function controls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}close`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}claim`).setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}add`).setLabel('Add user').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}transcript`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
  );
}

function closedControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}reopen`).setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}transcript`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TICKET_PREFIX}delete`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

/** Opens a ticket: its channel (numbered by its type's counter), the record, and the welcome message. */
export async function createTicket(guild, type, member, answers) {
  const counter = await TicketCounter.findOneAndUpdate(
    { guildId: guild.id, typeId: type.id },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const name = ticketName(type.namePattern, counter.seq, member.user.username);
  const me = guild.members.me;
  const staff = type.staffRoleIds.filter((id) => guild.roles.cache.has(id));
  const overwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: member.id, type: OverwriteType.Member, allow: MEMBER_ALLOW },
    ...staff.map((id) => ({ id, type: OverwriteType.Role, allow: STAFF_ALLOW })),
    { id: me.id, type: OverwriteType.Member, allow: BOT_ALLOW },
  ];
  const category = type.categoryId ? guild.channels.cache.get(type.categoryId) : null;
  const options = {
    name,
    type: ChannelType.GuildText,
    topic: `${type.name} · opened by ${member.user.username}`,
    permissionOverwrites: overwrites,
    reason: `Ticket opened by ${member.user.tag}`,
  };
  let channel;
  try {
    channel = await guild.channels.create({ ...options, parent: category?.type === ChannelType.GuildCategory ? category.id : null });
  } catch (err) {
    // (a full category holds 50 channels: open it outside rather than not at all)
    if (!category) throw err;
    console.error(`[tickets] couldn't open in category ${category.name}:`, err.message);
    channel = await guild.channels.create(options);
  }
  const ticket = await Ticket.create({
    guildId: guild.id, typeId: type.id, typeName: type.name, number: counter.seq, name, channelId: channel.id,
    openerId: member.id, openerName: member.user.username, answers,
  });

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`${type.emoji ? `${type.emoji} ` : ''}${type.name}`.slice(0, 256))
    .setDescription(fill(type.welcome, member).slice(0, 4000) || null)
    .setFooter({ text: `${name} · opened by ${member.user.username}` })
    .setTimestamp();
  for (const a of answers.slice(0, 5)) embed.addFields({ name: a.question.slice(0, 256), value: (a.answer || '—').slice(0, 1024) });
  const pings = type.pingStaff ? staff : [];
  await channel.send({
    content: [`${member}`, ...pings.map((id) => `<@&${id}>`)].join(' '),
    embeds: [embed],
    components: [controls()],
    allowedMentions: { users: [member.id], roles: pings },
  });
  console.log(`[tickets] ${member.user.tag} opened ${name} in ${guild.name}`);
  return { channel, ticket };
}

function formFor(type) {
  const modal = new ModalBuilder().setCustomId(`${TICKET_PREFIX}form:${type.id}`).setTitle(type.name.slice(0, 45));
  type.questions.slice(0, 5).forEach((q, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${i}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required)
      .setMaxLength(q.long ? 1000 : 200);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

async function typeFor(guild, typeId) {
  const gc = await getGuildConfig(guild.id);
  const type = gc.tickets.types.find((t) => t.id === typeId);
  if (!gc.tickets.enabled || !type) throw new TicketError('That kind of ticket isn’t available right now.');
  return type;
}

async function checkLimit(guild, userId, type) {
  const open = await openTicketsOf(guild, userId, type.id);
  if (open.length >= Math.max(1, type.maxOpen)) {
    throw new TicketError(`You already have an open ${type.name} ticket: <#${open[0].channelId}>`);
  }
}

async function openFromPanel(interaction, typeId) {
  const type = await typeFor(interaction.guild, typeId);
  await checkLimit(interaction.guild, interaction.user.id, type);
  if (type.questions.length) return interaction.showModal(formFor(type));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { channel } = await createTicket(interaction.guild, type, interaction.member, []);
  return interaction.editReply(`Your ticket is open: ${channel}`);
}

async function submitForm(interaction, typeId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const type = await typeFor(interaction.guild, typeId);
  await checkLimit(interaction.guild, interaction.user.id, type);
  const answers = type.questions.slice(0, 5).map((q, i) => {
    let answer = '';
    try {
      answer = interaction.fields.getTextInputValue(`q${i}`);
    } catch {
      // (the form changed while they were filling it in)
    }
    return { question: q.label, answer };
  });
  const { channel } = await createTicket(interaction.guild, type, interaction.member, answers);
  return interaction.editReply(`Your ticket is open: ${channel}`);
}

// ------------------------------------------------------------------ transcripts
/** Every message in the channel, oldest first (up to TRANSCRIPT_MAX). */
async function readMessages(channel) {
  const all = [];
  let before;
  while (all.length < TRANSCRIPT_MAX) {
    const batch = await channel.messages.fetch({ limit: 100, before, cache: false }).catch(() => null);
    if (!batch?.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.reverse().map((m) => ({
    authorId: m.author.id,
    author: m.member?.displayName ?? m.author.globalName ?? m.author.username,
    avatar: m.author.displayAvatarURL({ size: 64 }),
    bot: m.author.bot,
    content: m.content,
    at: m.createdAt,
    attachments: m.attachments.map((a) => ({ name: a.name, url: a.url })),
    embeds: m.embeds.map((e) => ({ title: e.title ?? '', description: e.description ?? '' })).filter((e) => e.title || e.description),
  }));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The transcript as a web page anyone can open (no login, no scripts). */
function transcriptHtml(guild, ticket, messages) {
  const when = (d) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const rows = messages.map((m) => {
    const text = m.content ? `<div class="text">${esc(m.content).replace(/\n/g, '<br>')}</div>` : '';
    const files = m.attachments.map((a) => `<a class="file" href="${esc(a.url)}">📎 ${esc(a.name)}</a>`).join('');
    const embeds = m.embeds.map((e) => `<div class="embed">${e.title ? `<b>${esc(e.title)}</b>` : ''}${e.description ? `<div>${esc(e.description).replace(/\n/g, '<br>')}</div>` : ''}</div>`).join('');
    const empty = !text && !files && !embeds ? '<div class="text muted">(no text)</div>' : '';
    return `<div class="msg"><img src="${esc(m.avatar)}" alt=""><div><div class="who"><b>${esc(m.author)}</b>${m.bot ? '<span class="bot">BOT</span>' : ''}<span class="at">${when(m.at)}</span></div>${text}${embeds}${files}${empty}</div></div>`;
  }).join('\n');
  const answers = ticket.answers.map((a) => `<div class="answer"><b>${esc(a.question)}</b><div>${esc(a.answer || '—').replace(/\n/g, '<br>')}</div></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ticket.name)} · ${esc(guild.name)}</title><style>
body{margin:0;background:#1e1f22;color:#dbdee1;font:15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}
header{padding:20px 24px;background:#2b2d31;border-bottom:1px solid #3f4147}h1{margin:0;font-size:20px;color:#f2f3f5}
.meta{color:#949ba4;font-size:13px;margin-top:4px}.answers{padding:12px 24px;background:#26272b}.answer{margin:8px 0}
.answer b{color:#f2f3f5}.msgs{padding:8px 0}.msg{display:flex;gap:14px;padding:8px 24px}.msg:hover{background:#2e3035}
.msg img{width:40px;height:40px;border-radius:50%;flex:none}.who b{color:#f2f3f5}.bot{background:#5865f2;color:#fff;font-size:10px;
font-weight:700;padding:1px 4px;border-radius:3px;margin-left:6px}.at{color:#949ba4;font-size:12px;margin-left:8px}
.text{white-space:normal;word-wrap:break-word}.muted{color:#949ba4;font-style:italic}.embed{border-left:4px solid #f08c1a;
background:#2b2d31;border-radius:4px;padding:8px 12px;margin-top:4px}.file{display:block;color:#00a8fc;margin-top:4px}
</style></head><body><header><h1>#${esc(ticket.name)}</h1><div class="meta">${esc(ticket.typeName)} · ${esc(guild.name)} · opened by
${esc(ticket.openerName)} ${when(ticket.createdAt)}${ticket.closedAt ? ` · closed by ${esc(ticket.closedBy?.name ?? '')} ${when(ticket.closedAt)}` : ''}${
  ticket.closeReason ? ` · “${esc(ticket.closeReason)}”` : ''} · ${messages.length} messages</div></header>
${answers ? `<section class="answers">${answers}</section>` : ''}<section class="msgs">${rows}</section></body></html>`;
}

function transcriptFile(guild, ticket, messages) {
  return new AttachmentBuilder(Buffer.from(transcriptHtml(guild, ticket, messages), 'utf8'), { name: `${ticket.name}.html` });
}

/** Posts a closed ticket's transcript in the transcript channel and DMs it to whoever opened it. */
async function deliverTranscript(guild, tickets, ticket) {
  const summary = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`${ticket.name} closed`)
    .addFields(
      { name: 'Type', value: ticket.typeName || '—', inline: true },
      { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
      { name: 'Closed by', value: ticket.closedBy?.id ? `<@${ticket.closedBy.id}>` : '—', inline: true },
      { name: 'Reason', value: ticket.closeReason || '—' },
      { name: 'Messages', value: String(ticket.transcript.length), inline: true },
      { name: 'Claimed by', value: ticket.claimedBy?.id ? `<@${ticket.claimedBy.id}>` : '—', inline: true },
    )
    .setTimestamp();
  const log = tickets.transcriptChannelId ? guild.channels.cache.get(tickets.transcriptChannelId) : null;
  if (log?.isTextBased()) {
    await log
      .send({ embeds: [summary], files: [transcriptFile(guild, ticket, ticket.transcript)], allowedMentions: { parse: [] } })
      .catch((err) => console.error('[tickets] posting a transcript failed:', err.message));
  }
  if (tickets.dmTranscript) {
    const user = await guild.client.users.fetch(ticket.openerId).catch(() => null);
    await user
      ?.send({
        content: `Your ticket **${ticket.name}** in **${guild.name}** was closed${ticket.closeReason ? `: ${ticket.closeReason}` : '.'} Here's what was said.`,
        files: [transcriptFile(guild, ticket, ticket.transcript)],
      })
      .catch(() => {}); // (their DMs are closed)
  }
}

// ------------------------------------------------------------------ what can be done in a ticket
/** Closes a ticket: the members in it can still read but not write, it moves to the closed category, its transcript is kept and sent. */
export async function closeTicket(guild, found, actor, reason = '') {
  const { ticket, gc } = found;
  if (ticket.status !== 'open') throw new TicketError('This ticket is already closed.');
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel) {
    for (const id of [ticket.openerId, ...ticket.addedUserIds]) {
      await channel.permissionOverwrites.edit(id, { SendMessages: false }, AS_MEMBER).catch(() => {});
    }
    const closed = gc.tickets.closedCategoryId ? guild.channels.cache.get(gc.tickets.closedCategoryId) : null;
    if (closed?.type === ChannelType.GuildCategory && channel.parentId !== closed.id) {
      await channel.setParent(closed.id, { lockPermissions: false }).catch((err) => console.error('[tickets] moving to closed failed:', err.message));
    }
    ticket.transcript = await readMessages(channel);
    ticket.transcriptAt = new Date();
  }
  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.closedBy = { id: actor.id, name: actor.user?.username ?? actor.username };
  ticket.closeReason = String(reason ?? '').slice(0, 500);
  await ticket.save();
  await deliverTranscript(guild, gc.tickets, ticket);
  return new EmbedBuilder()
    .setColor(0x80848e)
    .setDescription(`🔒 Closed by ${actor}${ticket.closeReason ? `\n> ${ticket.closeReason}` : ''}`)
    .setFooter({ text: 'Staff can reopen it, save its transcript, or delete the channel.' });
}

export async function reopenTicket(guild, found, actor) {
  const { ticket, type } = found;
  if (ticket.status !== 'closed') throw new TicketError('This ticket is open already.');
  const channel = guild.channels.cache.get(ticket.channelId);
  if (!channel) throw new TicketError('Its channel is gone.');
  for (const id of [ticket.openerId, ...ticket.addedUserIds]) {
    await channel.permissionOverwrites.edit(id, { SendMessages: true }, AS_MEMBER).catch(() => {});
  }
  const home = type?.categoryId ? guild.channels.cache.get(type.categoryId) : null;
  if (home?.type === ChannelType.GuildCategory && channel.parentId !== home.id) {
    await channel.setParent(home.id, { lockPermissions: false }).catch(() => {});
  }
  ticket.status = 'open';
  ticket.closedAt = null;
  ticket.closeReason = '';
  await ticket.save();
  return `🔓 Reopened by ${actor}.`;
}

export async function addUsers(guild, found, actor, users) {
  const channel = guild.channels.cache.get(found.ticket.channelId);
  if (!channel) throw new TicketError('Its channel is gone.');
  const added = [];
  for (const user of users) {
    if (user.bot || user.id === found.ticket.openerId) continue;
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true, SendMessages: found.ticket.status === 'open', ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true,
    }, AS_MEMBER);
    if (!found.ticket.addedUserIds.includes(user.id)) found.ticket.addedUserIds.push(user.id);
    added.push(user);
  }
  await found.ticket.save();
  if (!added.length) throw new TicketError('Nobody new to add.');
  return added;
}

export async function removeUser(guild, found, user) {
  const channel = guild.channels.cache.get(found.ticket.channelId);
  if (!channel) throw new TicketError('Its channel is gone.');
  if (user.id === found.ticket.openerId) throw new TicketError('That’s who opened the ticket: close it instead.');
  await channel.permissionOverwrites.delete(user.id).catch(() => {});
  found.ticket.addedUserIds = found.ticket.addedUserIds.filter((id) => id !== user.id);
  await found.ticket.save();
}

export async function claimTicket(found, actor) {
  const before = found.ticket.claimedBy?.id;
  found.ticket.claimedBy = { id: actor.id, name: actor.user.username };
  await found.ticket.save();
  return before && before !== actor.id ? `🙋 ${actor} took this ticket over from <@${before}>.` : `🙋 ${actor} is handling this ticket.`;
}

export async function renameTicket(guild, found, name) {
  const channel = guild.channels.cache.get(found.ticket.channelId);
  if (!channel) throw new TicketError('Its channel is gone.');
  const clean = slug(name).slice(0, 100);
  if (!clean) throw new TicketError('Give it a name with letters or numbers.');
  // (Discord lets a channel be renamed twice in 10 minutes)
  await channel.setName(clean).catch(() => {
    throw new TicketError('Discord didn’t rename it: a channel can be renamed twice every 10 minutes.');
  });
  return clean;
}

/** Its transcript right now (the live channel if it's still there, else the saved one). */
export async function currentTranscript(guild, found) {
  const channel = guild.channels.cache.get(found.ticket.channelId);
  const messages = channel ? await readMessages(channel) : found.ticket.transcript;
  return transcriptFile(guild, found.ticket, messages);
}

// ------------------------------------------------------------------ the buttons, dropdowns and forms
async function inTicket(interaction) {
  const found = await ticketIn(interaction.channel);
  if (!found) throw new TicketError('This isn’t a ticket any more.');
  return found;
}

async function handle(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  const ephemeral = { flags: MessageFlags.Ephemeral };
  switch (action) {
    case 'open':
      return openFromPanel(interaction, arg);
    case 'menu':
      try {
        return await openFromPanel(interaction, interaction.values[0]);
      } finally {
        // (Discord keeps the pick selected, and picking it again would do nothing: put the dropdown back)
        interaction.message.edit({ components: interaction.message.components }).catch(() => {});
      }
    case 'form':
      return submitForm(interaction, arg);
    case 'close': {
      const found = await inTicket(interaction);
      mustBeOpenerOrStaff(interaction.member, found.ticket, found.type);
      if (found.ticket.status !== 'open') throw new TicketError('This ticket is already closed.');
      const reason = new TextInputBuilder()
        .setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
      return interaction.showModal(
        new ModalBuilder().setCustomId(`${TICKET_PREFIX}closeform`).setTitle('Close this ticket').addComponents(new ActionRowBuilder().addComponents(reason)),
      );
    }
    case 'closeform': {
      await interaction.deferReply();
      const found = await inTicket(interaction);
      mustBeOpenerOrStaff(interaction.member, found.ticket, found.type);
      const embed = await closeTicket(interaction.guild, found, interaction.member, interaction.fields.getTextInputValue('reason'));
      return interaction.editReply({ embeds: [embed], components: [closedControls()] });
    }
    case 'reopen': {
      const found = await inTicket(interaction);
      mustBeStaff(interaction.member, found.type);
      const text = await reopenTicket(interaction.guild, found, interaction.member);
      return interaction.reply({ content: text, components: [controls()], allowedMentions: { parse: [] } });
    }
    case 'delete': {
      const found = await inTicket(interaction);
      mustBeStaff(interaction.member, found.type);
      if (found.ticket.status === 'open') await closeTicket(interaction.guild, found, interaction.member, 'Deleted');
      found.ticket.status = 'deleted';
      found.ticket.deletedAt = new Date();
      await found.ticket.save();
      await interaction.reply({ content: `🗑️ Deleting this channel in ${DELETE_DELAY_MS / 1000} seconds…`, allowedMentions: { parse: [] } });
      setTimeout(() => interaction.channel?.delete(`Ticket deleted by ${interaction.user.tag}`).catch(() => {}), DELETE_DELAY_MS);
      return undefined;
    }
    case 'claim': {
      const found = await inTicket(interaction);
      mustBeStaff(interaction.member, found.type);
      return interaction.reply({ content: await claimTicket(found, interaction.member), allowedMentions: { parse: [] } });
    }
    case 'add': {
      const found = await inTicket(interaction);
      mustBeOpenerOrStaff(interaction.member, found.ticket, found.type);
      const pick = new UserSelectMenuBuilder().setCustomId(`${TICKET_PREFIX}adduser`).setPlaceholder('Who should see this ticket?').setMinValues(1).setMaxValues(5);
      return interaction.reply({ ...ephemeral, content: 'Pick who to add:', components: [new ActionRowBuilder().addComponents(pick)] });
    }
    case 'adduser': {
      const found = await inTicket(interaction);
      mustBeOpenerOrStaff(interaction.member, found.ticket, found.type);
      const added = await addUsers(interaction.guild, found, interaction.member, [...interaction.users.values()]);
      await interaction.update({ content: `Added ${added.length === 1 ? added[0] : `${added.length} people`}.`, components: [] });
      await interaction.channel.send({ content: `➕ ${interaction.member} added ${added.join(', ')} to this ticket.`, allowedMentions: { users: added.map((u) => u.id) } });
      return undefined;
    }
    case 'transcript': {
      const found = await inTicket(interaction);
      mustBeOpenerOrStaff(interaction.member, found.ticket, found.type);
      await interaction.deferReply(ephemeral);
      return interaction.editReply({ content: 'Here’s the transcript so far.', files: [await currentTranscript(interaction.guild, found)] });
    }
    default:
      return undefined;
  }
}

/** Every ticket button, dropdown and form: problems are told to whoever pressed it, privately. */
export async function handleTicketInteraction(interaction) {
  try {
    await handle(interaction);
  } catch (err) {
    if (!(err instanceof TicketError)) throw err;
    const reply = { content: err.message, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: err.message }).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
}
