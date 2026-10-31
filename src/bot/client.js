import { Client, Events, GatewayIntentBits, MessageFlags, PermissionsBitField } from 'discord.js';
import { commandData, commands } from './commands/index.js';
import { handleRoleButton } from './interactions/roleButton.js';
import { handleVerifyButton } from './interactions/verifyButton.js';
import { ONBOARD_PREFIX, handleOnboarding } from './onboarding.js';
import { TICKET_PREFIX, handleTicketInteraction } from './tickets.js';
import { ROLE_BUTTON_PREFIX, VERIFY_BUTTON_ID } from './panel.js';
import { GuildConfig, getGuildConfig } from '../models/GuildConfig.js';
import { Ticket } from '../models/Ticket.js';
import { isVerified, updateMember } from '../roblox/verified.js';
import { recordMessage, startDiscordActivity } from '../team/discordActivity.js';
import { warmTeam } from '../team/roster.js';

const buttonHandlers = {
  [VERIFY_BUTTON_ID]: handleVerifyButton,
};

// View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Roles, Manage Nicknames,
// Manage Channels (ticket channels)
const INVITE_PERMISSIONS = new PermissionsBitField([
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'ManageRoles',
  'ManageNicknames',
  'ManageChannels',
]).bitfield;

// Guild Members (privileged: on in the Developer Portal) lists who holds which role for the Team tab; Guild Messages
// tells when members chat (the time only: no Message Content intent, so the bot never sees the text); Guild Voice
// States says who's in which voice channel (time in voice).
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
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

  await removeLinkPanels(c);
  startDiscordActivity(c);
  // (the member and role lists the Team tab needs, loaded now rather than on the first page view)
  for (const guild of c.guilds.cache.values()) {
    const started = Date.now();
    getGuildConfig(guild.id)
      .then((gc) => warmTeam(guild, gc.team))
      .then(() => console.log(`[team] lists ready in ${guild.name} after ${((Date.now() - started) / 1000).toFixed(1)}s`))
      .catch((err) => console.error(`[team] warming the lists failed in ${guild.name}:`, err.message));
  }
});

client.on(Events.MessageCreate, recordMessage);

// The Roblox link panel ("Link Roblox": a code typed in the game) is gone since 2026-10-25, the owner: "bloxlink
// handles the linking". Its message, if one was posted, is deleted once so nobody presses a dead button
async function removeLinkPanels(c) {
  const configs = await GuildConfig.find({ 'roblox.messageId': { $ne: null } });
  for (const gc of configs) {
    const channel = await c.channels.fetch(gc.roblox.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(gc.roblox.messageId).catch(() => null) : null;
    await message?.delete().catch(() => {});
    gc.roblox.channelId = null;
    gc.roblox.messageId = null;
    await gc.save();
    console.log(`[roblox] removed the old link panel in ${gc.guildId}`);
  }
}

// Bloxlink verified someone (the Verified role), unverified them, or their nickname changed: update them a moment
// later (Bloxlink often gives the role and the nickname one after the other)
const pendingUpdates = new Map(); // member id -> timeout
client.on(Events.GuildMemberUpdate, async (before, after) => {
  if (after.user.bot) return;
  const gc = await getGuildConfig(after.guild.id).catch(() => null);
  const rc = gc?.roblox;
  if (!rc?.enabled || !rc.verifiedRoleId) return;
  if (isVerified(rc, before) === isVerified(rc, after) && (before.nickname ?? '') === (after.nickname ?? '')) return;
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

// (a ticket channel deleted by hand while open: its ticket is done; a closed one just notes when its channel went)
client.on(Events.ChannelDelete, (channel) => {
  const now = new Date();
  Ticket.updateOne({ channelId: channel.id, status: 'open' }, { $set: { status: 'deleted', deletedAt: now } }).catch(() => {});
  Ticket.updateOne({ channelId: channel.id, status: 'closed', deletedAt: null }, { $set: { deletedAt: now } }).catch(() => {});
});

client.on(Events.InteractionCreate, async (interaction) => {
  // (the onboarding guide's Done button is pressed in DMs: before the server-only check)
  if (interaction.isButton() && interaction.customId.startsWith(ONBOARD_PREFIX)) {
    await handleOnboarding(interaction).catch((err) => {
      console.error('[onboarding] button failed:', err);
      if (!interaction.replied && !interaction.deferred) interaction.reply({ content: '⚠️ Something went wrong. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
    });
    return;
  }
  if (!interaction.inCachedGuild()) return;
  if (interaction.isAutocomplete()) {
    await commands.get(interaction.commandName)?.autocomplete?.(interaction).catch(() => {});
    return;
  }

  let handler;
  if (interaction.isChatInputCommand()) handler = commands.get(interaction.commandName)?.execute;
  else if ((interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith(TICKET_PREFIX)) {
    handler = handleTicketInteraction;
  } else if (interaction.isButton()) {
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
