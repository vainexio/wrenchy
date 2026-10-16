import { ChannelType, EmbedBuilder } from 'discord.js';
import { Announcement } from '../models/Announcement.js';
import { HttpError } from './errors.js';

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const HISTORY_LIMIT = 15;

function text(value, name, max) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${name} must be at most ${max} characters.`);
  return trimmed;
}

function url(value, name) {
  const link = text(value, name, 2000);
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new HttpError(400, `${name} must be a link starting with https://`);
  return link;
}

/** Turns the mention option into message text and the matching allowedMentions. */
function resolveMention(guild, channel, mention) {
  if (!mention || mention === 'none') return { prefix: '', allowedMentions: { parse: [] } };

  const me = guild.members.me;
  const canPingAll = channel.permissionsFor(me).has('MentionEveryone');
  if (mention === 'everyone' || mention === 'here') {
    if (!canPingAll) throw new HttpError(400, `Wrenchy needs the "Mention @everyone" permission in #${channel.name}.`);
    return { prefix: `@${mention}`, allowedMentions: { parse: ['everyone'] } };
  }

  const role = guild.roles.cache.get(mention);
  if (!role) throw new HttpError(400, 'The role to ping no longer exists.');
  if (!role.mentionable && !canPingAll) {
    throw new HttpError(400, `@${role.name} isn't pingable. Make it mentionable or give Wrenchy "Mention @everyone".`);
  }
  return { prefix: `${role}`, allowedMentions: { roles: [role.id] } };
}

function buildMessage(body) {
  const mode = body.mode === 'embed' ? 'embed' : 'text';
  const content = text(body.content, 'Message', 2000);

  if (mode === 'text') {
    if (!content) throw new HttpError(400, "The message can't be empty.");
    return { mode, content, embeds: [], summary: content };
  }

  const e = body.embed ?? {};
  const title = text(e.title, 'Title', 256);
  const description = text(e.description, 'Description', 4096);
  const footer = text(e.footer, 'Footer', 2048);
  const color = e.color || '#F5A623';
  if (!HEX_COLOR.test(color)) throw new HttpError(400, 'Color must be a hex code like #F5A623.');
  if (!title && !description) throw new HttpError(400, 'The embed needs a title or a description.');

  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  const titleUrl = url(e.url, 'Title link');
  const image = url(e.imageUrl, 'Image');
  const thumbnail = url(e.thumbnailUrl, 'Thumbnail');
  if (titleUrl && title) embed.setURL(titleUrl);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (e.timestamp) embed.setTimestamp();

  return { mode, content, embeds: [embed], summary: title || description };
}

export async function sendAnnouncement(guild, user, body) {
  const channel = guild.channels.cache.get(body.channelId);
  if (!channel || !CHANNEL_TYPES.includes(channel.type)) throw new HttpError(400, 'Pick a text channel.');

  const message = buildMessage(body);
  const needed = ['ViewChannel', 'SendMessages', ...(message.mode === 'embed' ? ['EmbedLinks'] : [])];
  const missing = channel.permissionsFor(guild.members.me).missing(needed);
  if (missing.length) throw new HttpError(400, `Wrenchy is missing ${missing.join(', ')} in #${channel.name}.`);

  const { prefix, allowedMentions } = resolveMention(guild, channel, body.mention);
  const content = [prefix, message.content].filter(Boolean).join(message.mode === 'text' ? ' ' : '\n');
  if (content.length > 2000) throw new HttpError(400, 'The message is too long once the ping is added.');

  let sent;
  try {
    sent = await channel.send({ content: content || undefined, embeds: message.embeds, allowedMentions });
  } catch (err) {
    throw new HttpError(400, `Discord rejected the message: ${err.message}`);
  }

  await Announcement.create({
    guildId: guild.id,
    channelId: channel.id,
    messageId: sent.id,
    mode: message.mode,
    summary: message.summary.slice(0, 140),
    sentBy: { id: user.id, name: user.name },
  });
  const kind = message.mode === 'embed' ? 'an embed' : 'a message';
  console.log(`[announce] ${user.name} sent ${kind} to #${channel.name} in ${guild.name}`);

  return { url: sent.url, history: await listAnnouncements(guild) };
}

export async function listAnnouncements(guild) {
  const rows = await Announcement.find({ guildId: guild.id }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
  return rows.map((a) => ({
    id: a._id,
    channelName: guild.channels.cache.get(a.channelId)?.name ?? 'deleted-channel',
    url: `https://discord.com/channels/${guild.id}/${a.channelId}/${a.messageId}`,
    mode: a.mode,
    summary: a.summary,
    sentBy: a.sentBy?.name,
    sentAt: a.createdAt,
  }));
}
