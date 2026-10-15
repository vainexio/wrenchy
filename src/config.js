import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const required = ['DISCORD_TOKEN', 'MONGODB_URI'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;

export const config = {
  token: process.env.DISCORD_TOKEN,
  mongoUri: process.env.MONGODB_URI,
  port,
  defaultRoleName: process.env.DEFAULT_VERIFIED_ROLE || 'Talyerista',
  clientSecret: process.env.DISCORD_CLIENT_SECRET || null,
  sessionSecret: process.env.SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || null,
  adminRoleId: process.env.ADMIN_ROLE_ID || '1560157523984646154',
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ''),
};
