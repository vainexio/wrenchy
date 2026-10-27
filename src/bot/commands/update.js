import { EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { updateMember } from '../../roblox/verified.js';

// /update [user]: rechecks one member's Roblox account and group roles right now and gives / takes their bound
// Discord roles (roblox/verified.js). Anyone can use it, on themselves or on anyone else, and the result is posted
// in the channel for everyone to see (only the "can't do that" notices stay private).

export const data = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Recheck a member’s Roblox group roles and update their Discord roles.')
  .addUserOption((o) => o.setName('user').setDescription('Who to update (default: you)'));

const roleList = (ids) => ids.map((id) => `<@&${id}>`).join(' ');

/** The reply's embed for one member's update. */
export function describeUpdate(r) {
  const name = escapeMarkdown(r.member.displayName);
  const e = new EmbedBuilder().setTitle(`Updated ${name}`);
  if (r.link) {
    e.setColor(r.added.length || r.removed.length ? 0x2fb36b : 0x5865f2).setDescription(
      `[${escapeMarkdown(r.link.displayName || r.link.username)} (@${escapeMarkdown(r.link.username)})](https://www.roblox.com/users/${r.link.robloxId}/profile), from their Bloxlink nickname.`,
    );
    const roles = r.link.roles.slice().sort((a, b) => b.rank - a.rank).map((x) => x.name);
    e.addFields({ name: 'Group roles', value: roles.length ? roles.join(', ') : 'None (not in the group, or no bound roles)' });
  } else if (r.unlinked) {
    e.setColor(0xf0a030).setDescription(`Unlinked from @${escapeMarkdown(r.unlinked.username)}: ${r.why ?? 'no longer verified'}.`);
  } else {
    e.setColor(0xe04848).setDescription(`Not linked: ${r.why ?? 'nothing links them to a Roblox account'}.`);
  }
  if (r.added.length) e.addFields({ name: 'Added', value: roleList(r.added) });
  if (r.removed.length) e.addFields({ name: 'Removed', value: roleList(r.removed) });
  if (r.link && !r.added.length && !r.removed.length) e.addFields({ name: 'Roles', value: 'Already up to date.' });
  if (r.problems.length) e.addFields({ name: 'Problems', value: r.problems.join('\n').slice(0, 1000) });
  return e;
}

export async function execute(interaction) {
  const target = interaction.options.getMember('user') ?? interaction.member;
  if (!target) {
    await interaction.reply({ content: 'That user isn’t in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  const gc = await getGuildConfig(interaction.guildId);
  if (!gc.roblox.enabled) {
    await interaction.reply({ content: 'Roblox Link is off on the dashboard.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  const result = await updateMember(interaction.guild, gc.roblox, target);
  await interaction.editReply({ embeds: [describeUpdate(result)], allowedMentions: { parse: [] } });
}
