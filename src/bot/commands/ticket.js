import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  TicketError, addUsers, claimTicket, closeTicket, currentTranscript, isStaff, removeUser, renameTicket, ticketIn,
} from '../tickets.js';

// /ticket: the ticket buttons from the keyboard, used inside a ticket channel. Add and close: staff or whoever opened
// it; remove, rename and claim: staff (bot/tickets.js says who's staff).

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage the ticket you’re in')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('add').setDescription('Let someone see and write in this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Who to add').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('remove').setDescription('Take someone out of this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('close').setDescription('Close this ticket (its transcript is saved)')
      .addStringOption((o) => o.setName('reason').setDescription('Why (kept with the ticket)').setMaxLength(500)))
  .addSubcommand((s) =>
    s.setName('rename').setDescription('Rename this ticket’s channel')
      .addStringOption((o) => o.setName('name').setDescription('The new name').setRequired(true).setMaxLength(100)))
  .addSubcommand((s) => s.setName('claim').setDescription('Say you’re handling this ticket'))
  .addSubcommand((s) => s.setName('transcript').setDescription('Get this ticket’s transcript so far'));

export async function execute(interaction) {
  const private_ = { flags: MessageFlags.Ephemeral };
  const found = await ticketIn(interaction.channel);
  if (!found) return interaction.reply({ ...private_, content: 'Use this inside a ticket channel.' });
  const { member, guild } = interaction;
  const staff = isStaff(member, found.type);
  const opener = member.id === found.ticket.openerId;
  const sub = interaction.options.getSubcommand();
  const only = (allowed, who) => {
    if (!allowed) throw new TicketError(`Only ${who} can do that.`);
  };
  try {
    switch (sub) {
      case 'add': {
        only(staff || opener, 'staff or whoever opened this ticket');
        const added = await addUsers(guild, found, member, [interaction.options.getUser('user', true)]);
        return interaction.reply({ content: `➕ ${member} added ${added[0]} to this ticket.`, allowedMentions: { users: [added[0].id] } });
      }
      case 'remove': {
        only(staff, 'staff');
        const user = interaction.options.getUser('user', true);
        await removeUser(guild, found, user);
        return interaction.reply({ content: `➖ ${member} removed ${user} from this ticket.`, allowedMentions: { parse: [] } });
      }
      case 'close': {
        only(staff || opener, 'staff or whoever opened this ticket');
        await interaction.deferReply();
        const embed = await closeTicket(guild, found, member, interaction.options.getString('reason') ?? '');
        return interaction.editReply({ embeds: [embed] });
      }
      case 'rename': {
        only(staff, 'staff');
        const name = await renameTicket(guild, found, interaction.options.getString('name', true));
        return interaction.reply({ ...private_, content: `Renamed to #${name}.` });
      }
      case 'claim':
        only(staff, 'staff');
        return interaction.reply({ content: await claimTicket(found, member), allowedMentions: { parse: [] } });
      case 'transcript':
        only(staff || opener, 'staff or whoever opened this ticket');
        await interaction.deferReply(private_);
        return interaction.editReply({ content: 'Here’s the transcript so far.', files: [await currentTranscript(guild, found)] });
      default:
        return undefined;
    }
  } catch (err) {
    if (!(err instanceof TicketError)) throw err;
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: err.message });
    return interaction.reply({ ...private_, content: err.message });
  }
}
