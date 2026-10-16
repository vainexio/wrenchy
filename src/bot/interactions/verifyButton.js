import { MessageFlags } from 'discord.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { VerificationLog } from '../../models/Verification.js';

export async function handleVerifyButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { guild, member } = interaction;
  const { verification } = await getGuildConfig(guild.id);

  if (!verification.enabled) {
    return interaction.editReply('Verification is currently disabled. Please try again later.');
  }

  const role = verification.roleId && (await guild.roles.fetch(verification.roleId).catch(() => null));
  if (!role) {
    return interaction.editReply('Verification isn\'t fully set up yet. Please let a staff member know.');
  }

  // Having the main role means verified. Extra roles are only given once, so members
  // who removed one later (e.g. via reaction roles) don't get it back by clicking again.
  if (member.roles.cache.has(role.id)) {
    return interaction.editReply(`You're already verified as ${role}. 🔧`);
  }

  await guild.roles.fetch();
  const extras = verification.extraRoleIds
    .map((id) => guild.roles.cache.get(id))
    .filter((r) => r && r.id !== role.id);

  try {
    await member.roles.add([role, ...extras], 'Completed verification');
  } catch (err) {
    console.error(`[verify] failed to add roles in ${guild.name}:`, err.message);
    return interaction.editReply(
      'I couldn\'t give you the role — my permissions may be misconfigured. Please let a staff member know.',
    );
  }

  await VerificationLog.create({
    guildId: guild.id,
    userId: member.id,
    userTag: member.user.tag,
    roleId: role.id,
  }).catch((err) => console.error('[verify] failed to log verification:', err.message));

  console.log(`[verify] ${member.user.tag} verified in ${guild.name} (+${extras.length} extra roles)`);
  return interaction.editReply(verification.successMessage);
}
