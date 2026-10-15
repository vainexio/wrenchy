import { MessageFlags } from 'discord.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { ROLE_BUTTON_PREFIX } from '../panel.js';

const fill = (template, role) => template.replaceAll('{role}', `${role}`);

export async function handleRoleButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { guild, member } = interaction;
  const roleId = interaction.customId.slice(ROLE_BUTTON_PREFIX.length);
  const { reactionRoles } = await getGuildConfig(guild.id);

  if (!reactionRoles.enabled) {
    return interaction.editReply('Role selection is currently disabled. Please try again later.');
  }
  // Only roles that are on the configured panel can be toggled.
  if (!reactionRoles.buttons.some((b) => b.roleId === roleId)) {
    return interaction.editReply('This button is no longer available.');
  }

  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return interaction.editReply("That role doesn't exist anymore. Please let a staff member know.");

  const hasRole = member.roles.cache.has(role.id);
  try {
    if (hasRole) await member.roles.remove(role, 'Reaction role');
    else await member.roles.add(role, 'Reaction role');
  } catch (err) {
    console.error(`[roles] failed to toggle ${role.name} in ${guild.name}:`, err.message);
    return interaction.editReply("I couldn't update your roles. Please let a staff member know.");
  }

  return interaction.editReply({
    content: fill(hasRole ? reactionRoles.removedMessage : reactionRoles.addedMessage, role),
    allowedMentions: { parse: [] },
  });
}
