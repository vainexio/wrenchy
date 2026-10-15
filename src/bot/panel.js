import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const VERIFY_BUTTON_ID = 'wrenchy:verify';
export const ROLE_BUTTON_PREFIX = 'wrenchy:role:';
export const MAX_ROLE_BUTTONS = 25; // Discord limit: 5 rows × 5 buttons

function buildVerificationPanel(verification) {
  const button = new ButtonBuilder()
    .setCustomId(VERIFY_BUTTON_ID)
    .setLabel(verification.buttonLabel)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!verification.enabled);
  if (verification.buttonEmoji) button.setEmoji(verification.buttonEmoji);

  return {
    content: verification.content,
    embeds: [], // clears the embed on panels posted by older versions
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

function buildReactionRolesPanel(reactionRoles) {
  const buttons = reactionRoles.buttons.map((b) => {
    const button = new ButtonBuilder()
      .setCustomId(`${ROLE_BUTTON_PREFIX}${b.roleId}`)
      .setLabel(b.label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!reactionRoles.enabled);
    if (b.emoji) button.setEmoji(b.emoji);
    return button;
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return { content: reactionRoles.content, embeds: [], components: rows };
}

// Each panel kind maps to a sub-document of GuildConfig and a message builder.
const PANELS = {
  verification: buildVerificationPanel,
  reactionRoles: buildReactionRolesPanel,
};

async function fetchExistingPanel(guild, settings) {
  if (!settings.channelId || !settings.messageId) return null;
  const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(settings.messageId).catch(() => null);
}

/** Edits the existing panel message in place. Returns false if there is no panel to edit. */
export async function refreshPanel(guild, guildConfig, kind) {
  const settings = guildConfig[kind];
  const message = await fetchExistingPanel(guild, settings);
  if (!message) return false;
  await message.edit(PANELS[kind](settings));
  return true;
}

/** Posts a fresh panel in `channel` (removing the old one) and saves its location. */
export async function postPanel(guild, guildConfig, kind, channel) {
  const settings = guildConfig[kind];
  const old = await fetchExistingPanel(guild, settings);
  const message = await channel.send(PANELS[kind](settings));
  if (old) await old.delete().catch(() => {});

  settings.channelId = channel.id;
  settings.messageId = message.id;
  await guildConfig.save();
  return message;
}
