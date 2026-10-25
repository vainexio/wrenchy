import { EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { config } from '../../config.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { updateGuild } from '../../roblox/verified.js';

// /updateall: /update for everyone holding the Verified role or linked (roblox/verified.js updateGuild), straight from
// Roblox. Dashboard role only; the reply is private and counts up while it runs.

export const data = new SlashCommandBuilder()
  .setName('updateall')
  .setDescription('Recheck everyone’s Roblox group roles and update their Discord roles.');

let running = false; // (one at a time: it touches everyone)

export async function execute(interaction) {
  if (!interaction.member.roles.cache.has(config.adminRoleId)) {
    await interaction.reply({ content: 'Only staff with the dashboard role can use this.', flags: MessageFlags.Ephemeral });
    return;
  }
  const gc = await getGuildConfig(interaction.guildId);
  if (!gc.roblox.enabled) {
    await interaction.reply({ content: 'Roblox Link is off on the dashboard.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (running) {
    await interaction.reply({ content: 'An update for everyone is already running. Give it a minute.', flags: MessageFlags.Ephemeral });
    return;
  }
  running = true;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply('Updating everyone… reading the group’s roles from Roblox.');
    let last = 0;
    const s = await updateGuild(interaction.guild, gc.roblox, {
      fresh: true,
      onProgress: async (done, total) => {
        if (Date.now() - last < 3000) return;
        last = Date.now();
        await interaction.editReply(`Updating everyone… ${done} of ${total}`).catch(() => {});
      },
    });
    const e = new EmbedBuilder()
      .setColor(s.problems.length ? 0xf0a030 : 0x2fb36b)
      .setTitle('Everyone updated')
      .setDescription(
        `Checked **${s.checked}** members: **${s.linked}** linked, **${s.changed}** had roles changed, **${s.unlinked}** unlinked.`,
      );
    if (!gc.roblox.verifiedRoleId) {
      e.addFields({ name: 'Bloxlink', value: 'No Verified role is set on the dashboard’s Roblox Link page, so only game links were checked.' });
    }
    if (s.notLinked.length) {
      const lines = s.notLinked.slice(0, 15).map((n) => `${escapeMarkdown(n.member.displayName)}: ${n.why}`);
      if (s.notLinked.length > 15) lines.push(`…and ${s.notLinked.length - 15} more`);
      e.addFields({ name: `Verified but not linked (${s.notLinked.length})`, value: lines.join('\n').slice(0, 1024) });
    }
    if (s.problems.length) {
      const lines = s.problems.slice(0, 10);
      if (s.problems.length > 10) lines.push(`…and ${s.problems.length - 10} more`);
      e.addFields({ name: `Problems (${s.problems.length})`, value: lines.join('\n').slice(0, 1024) });
    }
    await interaction.editReply({ content: '', embeds: [e], allowedMentions: { parse: [] } });
  } finally {
    running = false;
  }
}
