import { Client, Events, GatewayIntentBits, MessageFlags, PermissionsBitField } from 'discord.js';
import { commandData, commands } from './commands/index.js';
import { handleVerifyButton } from './interactions/verifyButton.js';
import { VERIFY_BUTTON_ID } from './panel.js';

const buttonHandlers = {
  [VERIFY_BUTTON_ID]: handleVerifyButton,
};

// View Channels, Send Messages, Embed Links, Read Message History, Manage Roles
const INVITE_PERMISSIONS = new PermissionsBitField([
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'ReadMessageHistory',
  'ManageRoles',
]).bitfield;

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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
});

client.on(Events.GuildCreate, registerCommands);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inCachedGuild()) return;

  let handler;
  if (interaction.isChatInputCommand()) handler = commands.get(interaction.commandName)?.execute;
  else if (interaction.isButton()) handler = buttonHandlers[interaction.customId];
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
