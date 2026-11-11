import {
  ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { config } from '../../config.js';
import { STICKY_MAX, STICKY_PREFIX, removeSticky, setSticky, stickyIn } from '../sticky.js';

// /sticky: a message kept at the bottom of a channel (bot/sticky.js). `set` opens a box to type it in (several lines,
// Discord formatting; the box starts with the current text), `remove` takes it down. Dashboard role only; replies are
// private.

const channelOption = (o) =>
  o.setName('channel').setDescription('Which channel (default: this one)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

export const data = new SlashCommandBuilder()
  .setName('sticky')
  .setDescription('Keep a message at the bottom of a channel')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('set').setDescription('Write the channel’s sticky message (replaces the current one)').addChannelOption(channelOption))
  .addSubcommand((s) => s.setName('remove').setDescription('Take the channel’s sticky message down').addChannelOption(channelOption));

const private_ = { flags: MessageFlags.Ephemeral };
const allowed = (member) => member.roles.cache.has(config.adminRoleId);

export async function execute(interaction) {
  if (!allowed(interaction.member)) {
    return interaction.reply({ ...private_, content: 'Only staff with the dashboard role can use this.' });
  }
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (interaction.options.getSubcommand() === 'remove') {
    const removed = await removeSticky(channel);
    return interaction.reply({ ...private_, content: removed ? `The sticky message in ${channel} is gone.` : `${channel} has no sticky message.` });
  }
  const text = new TextInputBuilder()
    .setCustomId('text')
    .setLabel('The message')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(STICKY_MAX);
  const current = stickyIn(channel.id);
  if (current) text.setValue(current);
  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${STICKY_PREFIX}set:${channel.id}`)
      .setTitle(`Sticky message in #${channel.name}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(text)),
  );
}

/** The box from `/sticky set` was sent. */
export async function handleStickyModal(interaction) {
  if (!allowed(interaction.member)) {
    return interaction.reply({ ...private_, content: 'Only staff with the dashboard role can use this.' });
  }
  const channelId = interaction.customId.slice(`${STICKY_PREFIX}set:`.length);
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  const content = interaction.fields.getTextInputValue('text').trim();
  if (!channel?.isTextBased()) return interaction.reply({ ...private_, content: 'That channel is gone.' });
  if (!content) return interaction.reply({ ...private_, content: 'The message is empty.' });
  await interaction.deferReply(private_);
  try {
    await setSticky(channel, content, interaction.user.id);
  } catch (err) {
    return interaction.editReply(`Couldn’t post in ${channel}: ${err.message}. Wrenchy needs View Channel and Send Messages there.`);
  }
  return interaction.editReply(
    `The sticky message is up in ${channel}. It moves back to the bottom a few seconds after anything else is posted there, and it never pings anyone.`,
  );
}
