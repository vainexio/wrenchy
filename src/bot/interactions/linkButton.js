import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getGuildConfig } from '../../models/GuildConfig.js';
import { LinkCode } from '../../models/LinkCode.js';
import { RobloxLink } from '../../models/RobloxLink.js';
import { syncEverywhere } from '../../roblox/sync.js';
import { LINK_BUTTON_ID } from '../panel.js';

const NEW_CODE_ID = `${LINK_BUTTON_ID}:new`;
const UNLINK_ID = `${LINK_BUTTON_ID}:unlink`;
export const LINK_BUTTON_IDS = [LINK_BUTTON_ID, NEW_CODE_ID, UNLINK_ID];

const CODE_TTL_MS = 10 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // (no 0/O, 1/I/L: easy to type in game)

// code -> the interaction that showed it, so a successful link in game can update that message
const pending = new Map();

function randomCode() {
  return Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function issueCode(interaction) {
  await LinkCode.deleteMany({ discordId: interaction.user.id });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await LinkCode.create({
        code,
        discordId: interaction.user.id,
        guildId: interaction.guildId,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      return code;
    } catch (err) {
      if (err.code !== 11000) throw err; // (duplicate code: try another)
    }
  }
  throw new Error('Could not generate a unique link code');
}

function codeMessage(code, gameUrl) {
  const expires = Math.floor((Date.now() + CODE_TTL_MS) / 1000);
  const buttons = [new ButtonBuilder().setCustomId(NEW_CODE_ID).setLabel('New code').setStyle(ButtonStyle.Secondary)];
  if (gameUrl) buttons.unshift(new ButtonBuilder().setLabel('Open Talyer').setStyle(ButtonStyle.Link).setURL(gameUrl));
  return {
    content:
      `Your link code is **\`${code}\`**\n\n` +
      `Join Talyer on Roblox and type **\`/link ${code}\`** in chat.\n` +
      `-# Expires <t:${expires}:R>. Only staff can link.`,
    components: [new ActionRowBuilder().addComponents(buttons)],
  };
}

function linkedMessage(link) {
  const roles = link.roles.length
    ? link.roles
        .slice()
        .sort((a, b) => b.rank - a.rank)
        .map((r) => r.name)
        .join(', ')
    : 'none';
  const synced = link.syncedAt ? `<t:${Math.floor(link.syncedAt.getTime() / 1000)}:R>` : 'not yet';
  return {
    content:
      `You're linked to **${link.displayName || link.username}** ([@${link.username}](https://www.roblox.com/users/${link.robloxId}/profile))\n` +
      `Group roles: ${roles}\n-# Roles last synced ${synced}. They update whenever you play, and every 30 minutes.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(NEW_CODE_ID).setLabel('Link a different account').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(UNLINK_ID).setLabel('Unlink').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

export async function handleLinkButton(interaction) {
  const { roblox } = await getGuildConfig(interaction.guildId);
  if (!roblox.enabled) {
    return interaction.reply({ content: 'Roblox linking is turned off right now.', flags: MessageFlags.Ephemeral });
  }

  // From the panel: a fresh private message. From that message's own buttons: update it in place.
  const respond = (payload) =>
    interaction.customId === LINK_BUTTON_ID
      ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
      : interaction.update(payload);

  if (interaction.customId === UNLINK_ID) {
    const link = await RobloxLink.findOneAndDelete({ discordId: interaction.user.id });
    if (link) {
      await syncEverywhere(interaction.client, interaction.user.id, null);
      console.log(`[roblox] ${interaction.user.tag} unlinked @${link.username}`);
    }
    return respond({ content: 'Unlinked. Your staff roles from Roblox were removed.', components: [] });
  }

  const link = interaction.customId === LINK_BUTTON_ID && (await RobloxLink.findOne({ discordId: interaction.user.id }));
  if (link) return respond(linkedMessage(link));

  const code = await issueCode(interaction);
  pending.set(code, interaction);
  setTimeout(() => pending.delete(code), CODE_TTL_MS);
  return respond(codeMessage(code, roblox.gameUrl));
}

/** Called after the game confirms a code: updates the private message that showed it, if it's still open. */
export async function notifyLinked(code, link) {
  const interaction = pending.get(code);
  pending.delete(code);
  if (!interaction) return;
  await interaction.editReply(linkedMessage(link)).catch(() => {});
}
