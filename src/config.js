import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const required = ['DISCORD_TOKEN', 'MONGODB_URI'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  mongoUri: process.env.MONGODB_URI,
  port: Number(process.env.PORT) || 3000,
  defaultRoleName: process.env.DEFAULT_VERIFIED_ROLE || 'Talyerista',
};
