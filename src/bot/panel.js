import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const VERIFY_BUTTON_ID = 'wrenchy:verify';

export function buildPanel(verification) {
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

async function fetchExistingPanel(guild, verification) {
  if (!verification.channelId || !verification.messageId) return null;
  const channel = await guild.channels.fetch(verification.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(verification.messageId).catch(() => null);
}

/** Edits the existing panel message in place. Returns false if there is no panel to edit. */
export async function refreshPanel(guild, guildConfig) {
  const message = await fetchExistingPanel(guild, guildConfig.verification);
  if (!message) return false;
  await message.edit(buildPanel(guildConfig.verification));
  return true;
}

/** Posts a fresh panel in `channel` (removing the old one) and saves its location. */
export async function postPanel(guild, guildConfig, channel) {
  const old = await fetchExistingPanel(guild, guildConfig.verification);
  const message = await channel.send(buildPanel(guildConfig.verification));
  if (old) await old.delete().catch(() => {});

  guildConfig.verification.channelId = channel.id;
  guildConfig.verification.messageId = message.id;
  await guildConfig.save();
  return message;
}
