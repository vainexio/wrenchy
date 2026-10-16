# Wrenchy 🔧

General-purpose Discord bot for **Talyer**, built on the MERN stack:

- **MongoDB** (Mongoose): per-server settings and verification logs
- **Express**: health check, status API, settings API, Discord login
- **React** (Vite): dashboard for managing the bot
- **Node.js** (discord.js v14): the bot

## Features

### Verification
New members click a button on the verification panel and get the **Talyerista** role, plus any extra roles you choose.
Everything is configured from the **dashboard**:

- Turn verification on/off (the button greys out when off)
- Choose the main role (creates `Talyerista` if it doesn't exist). Having it means "verified".
- Choose extra roles given at the same time (e.g. Giveaways, Updates). Members can remove them later and won't get them back by verifying again.
- Edit the panel message (plain text with Discord formatting), button label/emoji, and the reply after verifying, with a live preview
- Post or re-post the panel in any channel. Saving updates the posted panel in place.

### Reaction roles
A panel of buttons where members pick their own roles. Clicking a button adds the role, and clicking it again removes it.
Configured from the dashboard's **Reaction Roles** tab:

- Edit the panel message and the private "added" / "removed" replies (`{role}` is replaced with the role)
- Add up to 25 buttons, each with a role, label, and emoji. Pick an existing role or create a new one named after the label.
- Reorder or remove buttons, turn the panel on/off, and post it in any channel

### Announcements
Send a message from the bot to any channel from the **Announcements** tab:

- Normal message or embed (title, description, color, title link, image, thumbnail, footer, timestamp)
- Optional ping: @everyone, @here, or a role
- Live preview, confirmation before sending, and drafts kept in your browser
- History of recent announcements with who sent them

### Dashboard login
Staff log in with Discord. Only members who have the role in `ADMIN_ROLE_ID` (default `1560157523984646154`) can get in.
The role is re-checked on every request, so removing it revokes access immediately.

### Slash commands
- `/ping`: checks if the bot is alive

## Setup

### Discord Developer Portal
1. **Bot**: copy the token into `DISCORD_TOKEN`.
2. **OAuth2 → Client Secret**: copy it into `DISCORD_CLIENT_SECRET`.
3. **OAuth2 → Redirects**: add
   - `http://localhost:3000/api/auth/callback` (local)
   - `https://<your-app>.onrender.com/api/auth/callback` (Render)

### Discord server
1. Invite the bot (the link is printed in the console on startup). It needs **Manage Roles**.
2. In **Server Settings → Roles**, keep Wrenchy's role **above** `Talyerista`.
3. Hide your channels from `@everyone` and allow `Talyerista` to view them. Keep the verification channel visible to `@everyone`.
4. Open the dashboard, pick the channel, and click **Post panel**.

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
| Environment | `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `MONGODB_URI`, `ADMIN_ROLE_ID` |

Render sets `RENDER_EXTERNAL_URL` automatically, which is used for the login redirect. Set `PUBLIC_URL` only if you use a custom domain.
In MongoDB Atlas, allow Render's IPs under **Network Access** (or `0.0.0.0/0`).

## Adding commands
Create a file in `src/bot/commands/` that exports `data` (a `SlashCommandBuilder`) and `execute(interaction)`, then add it to `src/bot/commands/index.js`. Commands are registered in every server on startup.
