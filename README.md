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

### Roblox link (staff)
Staff link their Discord account to their Roblox account, and their Discord roles follow their rank in the group.

1. In Discord, staff press **Link Roblox** on the panel and get a 6-character code (10 minutes).
2. In Talyer they type `/link CODE` in chat. The game server sends the bot who they are and every group role they hold.
3. The bot gives the Discord roles bound to those Roblox roles (dashboard **Roblox Link** tab), an optional "linked" role, and sets their nickname.

Bindings match **Roblox role IDs**, never ranks, so reordering ranks in the group doesn't break them. Roles resync whenever linked staff join the game and every 30 minutes (the web check only sees someone's highest role; the game reports all of them). Only staff can link: the game decides who (`Config.Admin.DiscordLink.Roles`).

The game calls `POST /api/game/link` and `POST /api/game/roles` with the `X-Wrenchy-Key` header (= `GAME_API_KEY`). In Roblox the key lives in the experience's **Secrets Store** as `WrenchyKey` (domain `wrenchy.onrender.com`), and **Allow HTTP Requests** must be on. Secrets don't work in Play-in-Studio, so test linking in a live server.

### Auto-farm flags
The game's auto-farm watch (`ServerScriptService.Modules.AntiCheat`) flags players whose play no person could produce (walking through walls, floating, teleporting, swinging faster than the wrench allows, checking in customers with no window open, instant kahera payments...). Each game server sends its flags in batches to `POST /api/game/flag` (same `X-Wrenchy-Key`), and the bot posts them as embeds in the flag channel: `FLAG_CHANNEL_ID`, default `1561264779505705040`.

It's flag only: the game never punishes anyone for a flag. There's no server ID in the post. Mods search the username on the in-game admin panel (**FLAGS** page, or the player's profile). Wrenchy needs **View Channel**, **Send Messages** and **Embed Links** in that channel.

### Team activity
The dashboard's **Team** tab lists every tester and staff member with when they last **played** and last **chatted in Discord**, and flags who's been quiet for longer than the set days (default 7).

- **Who's in each group:** anyone holding one of the group's Roblox roles in the Piyesa group (read from Roblox's public role lists) or one of its Discord roles. The groups (Testers, Staff by default) and their roles are edited at the bottom of the tab.
- **Roblox ↔ Discord:** the same person when they linked through the game, someone matched them on the tab, or their Discord name gives the Roblox username away (`Name (@username)`, `username`). **Match Discord** searches the whole server by name, @username, nickname or ID (on the server, so it never loads every member); **Match Roblox** picks from the group's Roblox accounts nobody's matched yet; a match made by name can be corrected with **Change**. Matching by hand gives no roles.
- **The list:** everyone from every group once, with search, filters (group, status, accounts, role) and sorting that stay in the address bar, so a refresh or a shared link shows the same list. **Export** downloads what's shown as a CSV.
- **Last played:** Mangingisda (`ServerScriptService.Modules.TeamActivity`) reports group members (rank 2+) to `POST /api/game/presence` as they join, every 5 minutes while they play, and as they leave (same `X-Wrenchy-Key`). The tab shows who's in game now and the hours played since tracking began.
- **Last message:** Wrenchy notes when each member sends a message and in which channel, never the text (Guild Messages intent, no Message Content). **Scan Discord history** fills in the time before tracking began from the newest 1,000 messages of every channel it can read.

`/inactive [group] [days]` shows the inactive list in Discord (private reply, dashboard role only).

Needs the **Server Members Intent** in the Developer Portal (Bot → Privileged Gateway Intents) and **Read Message History** for the scan.

### Dashboard login
Staff log in with Discord. Only members who have the role in `ADMIN_ROLE_ID` (default `1560157523984646154`) can get in.
The role is re-checked on every request, so removing it revokes access immediately.

### Slash commands
- `/ping`: checks if the bot is alive
- `/inactive`: testers and staff who haven't played or chatted for a while

## Setup

### Discord Developer Portal
1. **Bot**: copy the token into `DISCORD_TOKEN`.
2. **OAuth2 → Client Secret**: copy it into `DISCORD_CLIENT_SECRET`.
3. **OAuth2 → Redirects**: add
   - `http://localhost:3000/api/auth/callback` (local)
   - `https://<your-app>.onrender.com/api/auth/callback` (Render)

### Discord server
1. Invite the bot (the link is printed in the console on startup). It needs **Manage Roles** and **Manage Nicknames**.
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
| Environment | `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `MONGODB_URI`, `ADMIN_ROLE_ID`, `GAME_API_KEY` |

Render sets `RENDER_EXTERNAL_URL` automatically, which is used for the login redirect. Set `PUBLIC_URL` only if you use a custom domain.
In MongoDB Atlas, allow Render's IPs under **Network Access** (or `0.0.0.0/0`).

## Adding commands
Create a file in `src/bot/commands/` that exports `data` (a `SlashCommandBuilder`) and `execute(interaction)`, then add it to `src/bot/commands/index.js`. Commands are registered in every server on startup.
