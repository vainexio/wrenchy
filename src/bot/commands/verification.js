import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { VerificationLog } from '../../models/Verification.js';
import { postPanel, refreshPanel } from '../panel.js';
import { checkAssignable, findOrCreateDefaultRole } from '../roles.js';

const HEX_COLOR = /^#?[0-9a-f]{6}$/i;

export const data = new SlashCommandBuilder()
  .setName('verification')
  .setDescription('Configure member verification.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Post the verification panel and set the verified role.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the verification button in')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role to give (default: Talyerista, created if missing)'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('role')
      .setDescription('Change the role given on verification.')
      .addRoleOption((o) => o.setName('role').setDescription('New verified role').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('message')
      .setDescription('Edit the verification panel text. Use \\n for new lines.')
      .addStringOption((o) => o.setName('title').setDescription('Embed title').setMaxLength(256))
      .addStringOption((o) =>
        o.setName('description').setDescription('Embed description').setMaxLength(4000),
      )
      .addStringOption((o) =>
        o.setName('button_label').setDescription('Button text').setMaxLength(80),
      )
      .addStringOption((o) =>
        o.setName('button_emoji').setDescription('Button emoji (type "none" to remove)'),
      )
      .addStringOption((o) =>
        o.setName('color').setDescription('Embed color as hex, e.g. #F5A623'),
      )
      .addStringOption((o) =>
        o
          .setName('success_message')
          .setDescription('Private reply shown after verifying')
          .setMaxLength(1500),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('send')
      .setDescription('Re-post the verification panel (removes the old one).')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post in (default: current panel channel)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('toggle')
      .setDescription('Enable or disable verification.')
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('Turn verification on or off').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show the current verification settings.'),
  );

const handlers = { setup, role, message, send, toggle, status };

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildConfig = await getGuildConfig(interaction.guildId);
  await handlers[interaction.options.getSubcommand()](interaction, guildConfig);
}

async function setup(interaction, guildConfig) {
  const { guild } = interaction;
  const channel = interaction.options.getChannel('channel', true);
  const role = interaction.options.getRole('role') ?? (await findOrCreateDefaultRole(guild));

  const roleError = checkAssignable(guild, role);
  if (roleError) return interaction.editReply(`⚠️ ${roleError}`);

  const missing = channel.permissionsFor(guild.members.me).missing(['ViewChannel', 'SendMessages', 'EmbedLinks']);
  if (missing.length) {
    return interaction.editReply(`⚠️ I'm missing these permissions in ${channel}: ${missing.join(', ')}`);
  }

  guildConfig.verification.roleId = role.id;
  guildConfig.verification.enabled = true;
  const panel = await postPanel(guild, guildConfig, channel);

  return interaction.editReply(
    `✅ Verification is set up! Panel posted in ${channel} ([jump](${panel.url})). Members who click it get ${role}.\n` +
      `-# Tip: hide your other channels from @everyone and allow ${role} to see them.`,
  );
}

async function role(interaction, guildConfig) {
  const newRole = interaction.options.getRole('role', true);
  const roleError = checkAssignable(interaction.guild, newRole);
  if (roleError) return interaction.editReply(`⚠️ ${roleError}`);

  guildConfig.verification.roleId = newRole.id;
  await guildConfig.save();
  return interaction.editReply(`✅ Verified role set to ${newRole}.`);
}

async function message(interaction, guildConfig) {
  const opts = interaction.options;
  const v = guildConfig.verification;
  const text = (name) => opts.getString(name)?.replace(/\\n/g, '\n');

  const color = opts.getString('color');
  if (color && !HEX_COLOR.test(color)) {
    return interaction.editReply('⚠️ Color must be a hex code like `#F5A623`.');
  }

  const changes = {
    title: text('title'),
    description: text('description'),
    buttonLabel: opts.getString('button_label'),
    buttonEmoji: opts.getString('button_emoji'),
    color: color && (color.startsWith('#') ? color : `#${color}`),
    successMessage: text('success_message'),
  };
  if (changes.buttonEmoji?.toLowerCase() === 'none') changes.buttonEmoji = '';

  const applied = Object.entries(changes).filter(([, value]) => value != null);
  if (!applied.length) return interaction.editReply('Nothing to change — pick at least one option.');

  const previous = { ...v.toObject() };
  for (const [key, value] of applied) v[key] = value;

  try {
    const updated = await refreshPanel(interaction.guild, guildConfig);
    await guildConfig.save();
    const note = updated ? 'The panel was updated.' : 'No panel found yet — run `/verification setup` to post one.';
    return interaction.editReply(`✅ Updated ${applied.map(([k]) => `\`${k}\``).join(', ')}. ${note}`);
  } catch (err) {
    Object.assign(v, previous);
    return interaction.editReply(`⚠️ Discord rejected that change (is the emoji valid?): ${err.message}`);
  }
}

async function send(interaction, guildConfig) {
  const { guild } = interaction;
  const v = guildConfig.verification;
  const channel =
    interaction.options.getChannel('channel') ??
    (v.channelId && (await guild.channels.fetch(v.channelId).catch(() => null)));

  if (!channel) return interaction.editReply('⚠️ No panel channel set. Pick a channel or run `/verification setup`.');
  if (!v.roleId) return interaction.editReply('⚠️ No verified role set yet. Run `/verification setup` first.');

  const panel = await postPanel(guild, guildConfig, channel);
  return interaction.editReply(`✅ Panel posted in ${channel} ([jump](${panel.url})).`);
}

async function toggle(interaction, guildConfig) {
  const enabled = interaction.options.getBoolean('enabled', true);
  guildConfig.verification.enabled = enabled;
  await guildConfig.save();
  await refreshPanel(interaction.guild, guildConfig).catch(() => {});
  return interaction.editReply(enabled ? '✅ Verification enabled.' : '⏸️ Verification disabled — the button is now greyed out.');
}

async function status(interaction, guildConfig) {
  const v = guildConfig.verification;
  const verifiedCount = await VerificationLog.countDocuments({ guildId: interaction.guildId });
  const panelLink =
    v.channelId && v.messageId
      ? `https://discord.com/channels/${interaction.guildId}/${v.channelId}/${v.messageId}`
      : null;

  const embed = new EmbedBuilder()
    .setTitle('Verification settings')
    .setColor(v.color)
    .addFields(
      { name: 'Status', value: v.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Role', value: v.roleId ? `<@&${v.roleId}>` : 'Not set', inline: true },
      { name: 'Verified so far', value: String(verifiedCount), inline: true },
      { name: 'Panel', value: panelLink ? `<#${v.channelId}> · [jump](${panelLink})` : 'Not posted', inline: false },
      { name: 'Title', value: v.title },
      { name: 'Description', value: v.description.slice(0, 1024) },
      { name: 'Button', value: `${v.buttonEmoji ? `${v.buttonEmoji} ` : ''}${v.buttonLabel}`, inline: true },
      { name: 'Color', value: v.color, inline: true },
      { name: 'Success message', value: v.successMessage.slice(0, 1024) },
    );
  return interaction.editReply({ embeds: [embed] });
}
