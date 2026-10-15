import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if Wrenchy is alive.');

export async function execute(interaction) {
  const sent = Date.now();
  await interaction.reply({ content: 'Pong! 🔧' });
  const roundTrip = Date.now() - sent;
  await interaction.editReply(
    `Pong! 🔧 Round-trip: **${roundTrip}ms** · Gateway: **${interaction.client.ws.ping}ms**`,
  );
}
