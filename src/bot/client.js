import { Client, Events, GatewayIntentBits, MessageFlags, PermissionsBitField } from 'discord.js';
import { commandData, commands } from './commands/index.js';
import { handleLinkButton, LINK_BUTTON_IDS } from './interactions/linkButton.js';
import { handleRoleButton } from './interactions/roleButton.js';
import { handleVerifyButton } from './interactions/verifyButton.js';
import { ROLE_BUTTON_PREFIX, VERIFY_BUTTON_ID } from './panel.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { isVerified, nicknameUsername, recheckAll, updateMember } from '../roblox/verified.js';
import { recordMessage, startDiscordActivity } from '../team/discordActivity.js';

const buttonHandlers = {
  [VERIFY_BUTTON_ID]: handleVerifyButton,
  ...Object.fromEntries(LINK_BUTTON_IDS.map((id) => [id, handleLinkButton])),
};

const RECHECK_EVERY_MS = 30 * 60 * 1000;

// View Channels, Send Messages, Embed Links, Read Message History, Manage Roles, Manage Nicknames
const INVITE_PERMISSIONS = new PermissionsBitField([
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'ReadMessageHistory',
  'ManageRoles',
  'ManageNicknames',
]).bitfield;

// Guild Members (privileged: on in the Developer Portal) lists who holds which role for the Team tab; Guild Messages
// tells when members chat (the time only: no Message Content intent, so the bot never sees the text).
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});

async function registerCommands(guild) {
  try {
    await guild.commands.set(commandData);
    console.log(`[bot] registered ${commandData.length} commands in ${guild.name}`);
  } catch (err) {
    console.error(`[bot] failed to register commands in ${guild.name}:`, err.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag} — in ${c.guilds.cache.size} server(s)`);
  console.log(
    `[bot] invite: https://discord.com/oauth2/authorize?client_id=${c.user.id}` +
      `&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`,
  );
  await Promise.all(c.guilds.cache.map(registerCommands));

  // Roblox links: recheck everyone's group roles every 30 minutes (promotions / demotions / Bloxlink verifications
  // apply on their own: roblox/verified.js)
  setInterval(() => recheckAll(c).catch((err) => console.error('[roblox] recheck failed:', err)), RECHECK_EVERY_MS);
  startDiscordActivity(c);
});

client.on(Events.MessageCreate, recordMessage);

// Bloxlink verified someone (the Verified role), unverified them, or their nickname changed: update them a moment
// later (Bloxlink often gives the role and the nickname one after the other)
const pendingUpdates = new Map(); // member id -> timeout
client.on(Events.GuildMemberUpdate, async (before, after) => {
  if (after.user.bot) return;
  const gc = await getGuildConfig(after.guild.id).catch(() => null);
  const rc = gc?.roblox;
  if (!rc?.enabled || !rc.verifiedRoleId) return;
  if (isVerified(rc, before) === isVerified(rc, after) && nicknameUsername(before) === nicknameUsername(after)) return;
  clearTimeout(pendingUpdates.get(after.id));
  pendingUpdates.set(
    after.id,
    setTimeout(async () => {
      pendingUpdates.delete(after.id);
      try {
        const member = await after.guild.members.fetch({ user: after.id, force: true });
        const r = await updateMember(after.guild, rc, member);
        console.log(`[roblox] ${member.user.tag}: ${r.link ? `@${r.link.username}` : r.why ?? 'not linked'} (+${r.added.length} -${r.removed.length})`);
      } catch (err) {
        console.error(`[roblox] auto update failed for ${after.id}:`, err.message);
      }
    }, 5000),
  );
});

client.on(Events.GuildCreate, registerCommands);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inCachedGuild()) return;
  if (interaction.isAutocomplete()) {
    await commands.get(interaction.commandName)?.autocomplete?.(interaction).catch(() => {});
    return;
  }

  let handler;
  if (interaction.isChatInputCommand()) handler = commands.get(interaction.commandName)?.execute;
  else if (interaction.isButton()) {
    handler = interaction.customId.startsWith(ROLE_BUTTON_PREFIX)
      ? handleRoleButton
      : buttonHandlers[interaction.customId];
  }
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (err) {
    console.error('[bot] interaction error:', err);
    const reply = { content: '⚠️ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});
