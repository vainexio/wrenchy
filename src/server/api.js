import { ChannelType } from 'discord.js';
import express from 'express';
import { config } from '../config.js';
import { postPanel, refreshPanel } from '../bot/panel.js';
import { checkAssignable, findDefaultRole, findOrCreateDefaultRole } from '../bot/roles.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { VerificationLog } from '../models/Verification.js';

const PANEL_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const CREATE_DEFAULT_ROLE = '__create__';

const TEXT_FIELDS = {
  content: { max: 2000, required: true },
  buttonLabel: { max: 80, required: true },
  buttonEmoji: { max: 64, required: false },
  successMessage: { max: 2000, required: true },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getGuild(client, guildId) {
  if (!client.isReady()) throw new HttpError(503, 'The bot is not connected to Discord yet.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, 'Wrenchy is not in that server.');
  return guild;
}

async function describeGuild(guild, guildConfig) {
  const v = guildConfig.verification;
  const me = guild.members.me;
  const verifiedCount = await VerificationLog.countDocuments({ guildId: guild.id });

  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, problem: checkAssignable(guild, r) }));

  const channels = guild.channels.cache
    .filter((c) => PANEL_CHANNEL_TYPES.includes(c.type))
    .sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition)
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.parent?.name ?? null,
      canPost: c.permissionsFor(me).has(['ViewChannel', 'SendMessages', 'EmbedLinks']),
    }));

  return {
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL({ size: 64 }),
    defaultRoleName: config.defaultRoleName,
    defaultRoleExists: Boolean(findDefaultRole(guild)),
    roles,
    channels,
    verifiedCount,
    panelUrl:
      v.channelId && v.messageId ? `https://discord.com/channels/${guild.id}/${v.channelId}/${v.messageId}` : null,
    verification: v.toObject(),
  };
}

async function applyChanges(guild, guildConfig, body) {
  const v = guildConfig.verification;

  for (const [key, rule] of Object.entries(TEXT_FIELDS)) {
    if (body[key] === undefined) continue;
    const value = typeof body[key] === 'string' ? body[key].trim() : null;
    if (value === null) throw new HttpError(400, `${key} must be text.`);
    if (rule.required && !value) throw new HttpError(400, `${key} can't be empty.`);
    if (value.length > rule.max) throw new HttpError(400, `${key} must be at most ${rule.max} characters.`);
    v[key] = value;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false.');
    v.enabled = body.enabled;
  }

  if (body.roleId !== undefined) {
    const role =
      body.roleId === CREATE_DEFAULT_ROLE
        ? await findOrCreateDefaultRole(guild)
        : guild.roles.cache.get(body.roleId);
    if (!role) throw new HttpError(400, 'That role no longer exists.');
    const problem = checkAssignable(guild, role);
    if (problem) throw new HttpError(400, problem);
    v.roleId = role.id;
  }
}

export function createApiRouter(client, auth) {
  const router = express.Router();
  router.use(auth.requireAuth);

  router.get('/auth/me', auth.me);

  router.get('/guilds', (_req, res) => {
    if (!client.isReady()) throw new HttpError(503, 'The bot is not connected to Discord yet.');
    res.json(client.guilds.cache.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) })));
  });

  router.get('/guilds/:guildId', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await describeGuild(guild, await getGuildConfig(guild.id)));
  });

  // Saves settings and updates the posted panel in place.
  router.put('/guilds/:guildId/verification', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const guildConfig = await getGuildConfig(guild.id);
    await applyChanges(guild, guildConfig, req.body ?? {});

    // Edit the live panel before saving so an invalid emoji etc. doesn't get persisted.
    try {
      await refreshPanel(guild, guildConfig);
    } catch (err) {
      throw new HttpError(400, `Discord rejected the panel (is the emoji valid?): ${err.message}`);
    }
    await guildConfig.save();
    res.json(await describeGuild(guild, guildConfig));
  });

  // Posts (or re-posts) the verification panel in a channel.
  router.post('/guilds/:guildId/verification/panel', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const guildConfig = await getGuildConfig(guild.id);
    if (!guildConfig.verification.roleId) throw new HttpError(400, 'Choose a verified role and save first.');

    const channel = guild.channels.cache.get(req.body?.channelId);
    if (!channel || !PANEL_CHANNEL_TYPES.includes(channel.type)) throw new HttpError(400, 'Pick a text channel.');
    const missing = channel.permissionsFor(guild.members.me).missing(['ViewChannel', 'SendMessages', 'EmbedLinks']);
    if (missing.length) throw new HttpError(400, `Wrenchy is missing ${missing.join(', ')} in #${channel.name}.`);

    await postPanel(guild, guildConfig, channel);
    res.json(await describeGuild(guild, guildConfig));
  });

  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('[api] error:', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return router;
}
