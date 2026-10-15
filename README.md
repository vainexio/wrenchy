# Wrenchy 🔧

General-purpose Discord bot for **Talyer**, built on the MERN stack:

- **MongoDB** (Mongoose): per-server settings and verification logs
- **Express**: health check + status API, serves the dashboard
- **React** (Vite): small status dashboard
- **Node.js** (discord.js v14): the bot

## Features

### Verification
New members click a button on the verification panel and get the **Talyerista** role.

| Command | What it does |
| --- | --- |
| `/verification setup channel [role]` | Posts the panel and sets the role (defaults to `Talyerista`, created if missing) |
| `/verification role role` | Change the role given on verification |
| `/verification message [title] [description] [button_label] [button_emoji] [color] [success_message]` | Edit the panel text; the posted panel updates in place. Use `\n` for new lines |
| `/verification send [channel]` | Re-post the panel (the old one is removed) |
| `/verification toggle enabled` | Turn verification on/off (the button greys out) |
| `/verification status` | Show current settings and how many members have verified |

`/verification` needs the **Manage Server** permission by default.

### Other
- `/ping`: checks if the bot is alive

## Discord server setup
1. Invite the bot (the link is printed in the console on startup). It needs **Manage Roles**.
2. In **Server Settings → Roles**, drag the Wrenchy role **above** `Talyerista`.
3. Hide your channels from `@everyone` and allow `Talyerista` to view them. Keep the verification channel visible to `@everyone`.
4. Run `/verification setup channel:#verify`.

## Running locally
```bash
npm install
cp .env.example .env   # then fill in the values
npm run build          # builds the React dashboard
npm start              # http://localhost:3000
```
Use `npm run dev` to auto-restart on file changes.

## Deploying on Render
Create a **Web Service** from this repo:

| Setting | Value |
| --- | --- |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Environment | `DISCORD_TOKEN`, `MONGODB_URI` |

In MongoDB Atlas, allow Render's IPs under **Network Access** (or `0.0.0.0/0`).

## Adding commands
Create a file in `src/bot/commands/` that exports `data` (a `SlashCommandBuilder`) and `execute(interaction)`, then add it to `src/bot/commands/index.js`. Commands are registered in every server on startup.
