import { EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { config } from '../../config.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { buildTeam } from '../../team/roster.js';

// /inactive: the testers and staff who haven't played or chatted for a while (the dashboard's Team tab, in Discord).
// Only the dashboard role can use it; the reply is private.

const MAX_LINES = 25;

export const data = new SlashCommandBuilder()
  .setName('inactive')
  .setDescription('Testers and staff who haven’t played or chatted for a while.')
  .addStringOption((o) => o.setName('group').setDescription('Only this group (e.g. Testers, Staff)').setAutocomplete(true))
  .addIntegerOption((o) =>
    o.setName('days').setDescription('Inactive after this many days (default: the dashboard setting)').setMinValue(1).setMaxValue(90),
  );

function ago(date) {
  if (!date) return 'never';
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  return days < 1 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
}

function who(p) {
  const roblox = p.username ? `[@${escapeMarkdown(p.username)}](https://www.roblox.com/users/${p.robloxId}/profile)` : null;
  const discord = p.discordId && p.inServer ? `<@${p.discordId}>` : null;
  return [discord, roblox].filter(Boolean).join(' · ') || 'Unknown';
}

export async function autocomplete(interaction) {
  const gc = await getGuildConfig(interaction.guildId);
  const typed = interaction.options.getFocused().toLowerCase();
  await interaction.respond(
    gc.team.groups.filter((g) => g.name.toLowerCase().includes(typed)).slice(0, 25).map((g) => ({ name: g.name, value: g.name })),
  );
}

export async function execute(interaction) {
  if (!interaction.member.roles.cache.has(config.adminRoleId)) {
    await interaction.reply({ content: 'Only staff with the dashboard role can use this.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const gc = await getGuildConfig(interaction.guildId);
  const days = interaction.options.getInteger('days') ?? gc.team.inactiveDays;
  const only = interaction.options.getString('group')?.toLowerCase();
  const team = { ...gc.team.toObject(), inactiveDays: days };
  const groups = (await buildTeam(interaction.guild, team)).filter((g) => !only || g.name.toLowerCase() === only);
  if (!groups.length) {
    await interaction.editReply('No group by that name. Groups are set on the dashboard’s Team tab.');
    return;
  }

  const embeds = groups.map((g) => {
    const inactive = g.people.filter((p) => p.inactiveGame || p.inactiveDiscord);
    const lines = inactive.slice(0, MAX_LINES).map((p) => {
      const game = p.robloxId ? `🎮 ${ago(p.game?.lastSeenAt)}` : '🎮 no Roblox account found';
      const chat = p.discordId && p.inServer ? `💬 ${ago(p.discord?.lastMessageAt)}` : '💬 not in the server';
      return `${who(p)}\n   ${game} · ${chat}`;
    });
    if (inactive.length > MAX_LINES) lines.push(`…and ${inactive.length - MAX_LINES} more (see the dashboard’s Team tab).`);
    return new EmbedBuilder()
      .setColor(inactive.length ? 0xf0a030 : 0x2fb36b)
      .setTitle(`${g.name}: ${inactive.length} of ${g.people.length} inactive`)
      .setDescription(lines.join('\n') || `Everyone played and chatted in the last ${days} days. 🎉`)
      .setFooter({ text: `Inactive = no game time or no Discord message in ${days}+ days` });
  });
  await interaction.editReply({ embeds: embeds.slice(0, 10), allowedMentions: { parse: [] } });
}
