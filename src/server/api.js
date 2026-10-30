import { ChannelType } from 'discord.js';
import express from 'express';
import { config } from '../config.js';
import { MAX_ROLE_BUTTONS, postPanel, refreshPanel } from '../bot/panel.js';
import { checkAssignable, findDefaultRole, findOrCreateDefaultRole } from '../bot/roles.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { VerificationLog } from '../models/Verification.js';
import { listAnnouncements, sendAnnouncement } from './announcements.js';
import { HttpError } from './errors.js';
import { applyRoblox, robloxOverview, syncGuild, updateOne } from './robloxAdmin.js';
import { matchMember, saveTeam, searchMembers, startScan, teamOverview } from './teamAdmin.js';
import { listTickets, postPanel as postTicketPanel, saveTickets, ticketTranscript, ticketsOverview } from './tickets.js';
import {
  addMember, changeRole, listNotices, listRecords, lookupRoblox, rankingInfo, reinstate, sendNotice, takeOff,
} from './teamManage.js';

const PANEL_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const CREATE_DEFAULT_ROLE = '__create__';
const CREATE_NEW_ROLE = '__new__';

// URL segment -> GuildConfig key
const PANEL_KINDS = { verification: 'verification', 'reaction-roles': 'reactionRoles', roblox: 'roblox' };

const VERIFICATION_TEXT = {
  content: { max: 2000, required: true },
  buttonLabel: { max: 80, required: true },
  buttonEmoji: { max: 64, required: false },
  successMessage: { max: 2000, required: true },
};

const REACTION_ROLES_TEXT = {
  content: { max: 2000, required: true },
  addedMessage: { max: 500, required: true },
  removedMessage: { max: 500, required: true },
};


function getGuild(client, guildId) {
  if (!client.isReady()) throw new HttpError(503, 'The bot is not connected to Discord yet.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, 'Wrenchy is not in that server.');
  return guild;
}

const panelUrl = (guild, settings) =>
  settings.channelId && settings.messageId
    ? `https://discord.com/channels/${guild.id}/${settings.channelId}/${settings.messageId}`
    : null;

async function describeGuild(guild, guildConfig) {
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
    panelUrls: {
      verification: panelUrl(guild, guildConfig.verification),
      reactionRoles: panelUrl(guild, guildConfig.reactionRoles),
    },
    verification: guildConfig.verification.toObject(),
    reactionRoles: guildConfig.reactionRoles.toObject(),
    roblox: guildConfig.roblox.toObject(),
  };
}

function cleanText(value, name, { max, required }) {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text.`);
  const text = value.trim();
  if (required && !text) throw new HttpError(400, `${name} can't be empty.`);
  if (text.length > max) throw new HttpError(400, `${name} must be at most ${max} characters.`);
  return text;
}

function applyText(settings, body, rules) {
  for (const [key, rule] of Object.entries(rules)) {
    if (body[key] !== undefined) settings[key] = cleanText(body[key], key, rule);
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false.');
    settings.enabled = body.enabled;
  }
}

function assertAssignable(guild, role) {
  const problem = checkAssignable(guild, role);
  if (problem) throw new HttpError(400, problem);
}

async function applyVerification(guild, guildConfig, body) {
  const v = guildConfig.verification;
  applyText(v, body, VERIFICATION_TEXT);

  if (body.roleId !== undefined) {
    const role =
      body.roleId === CREATE_DEFAULT_ROLE
        ? await findOrCreateDefaultRole(guild)
        : guild.roles.cache.get(body.roleId);
    if (!role) throw new HttpError(400, 'That role no longer exists.');
    assertAssignable(guild, role);
    v.roleId = role.id;
  }

  if (body.extraRoleIds !== undefined) {
    if (!Array.isArray(body.extraRoleIds)) throw new HttpError(400, 'extraRoleIds must be a list.');
    const ids = [...new Set(body.extraRoleIds)].filter((id) => id !== v.roleId);
    for (const id of ids) {
      const role = guild.roles.cache.get(id);
      if (!role) throw new HttpError(400, 'One of the extra roles no longer exists.');
      assertAssignable(guild, role);
    }
    v.extraRoleIds = ids;
  }
}

async function applyReactionRoles(guild, guildConfig, body) {
  const rr = guildConfig.reactionRoles;
  applyText(rr, body, REACTION_ROLES_TEXT);
  if (body.buttons === undefined) return;

  if (!Array.isArray(body.buttons)) throw new HttpError(400, 'buttons must be a list.');
  if (body.buttons.length > MAX_ROLE_BUTTONS) throw new HttpError(400, `You can have at most ${MAX_ROLE_BUTTONS} buttons.`);

  // Validate everything before creating any roles, so a bad request doesn't leave stray roles behind.
  const buttons = body.buttons.map((b, i) => {
    const n = `Button ${i + 1}`;
    const label = cleanText(b?.label, `${n} label`, { max: 80, required: true });
    const emoji = cleanText(b?.emoji ?? '', `${n} emoji`, { max: 64, required: false });
    if (b.roleId === CREATE_NEW_ROLE) return { label, emoji, roleId: null };
    const role = guild.roles.cache.get(b.roleId);
    if (!role) throw new HttpError(400, `${n}: that role no longer exists.`);
    assertAssignable(guild, role);
    return { label, emoji, roleId: role.id };
  });

  for (const button of buttons.filter((b) => !b.roleId)) {
    // Reuse a role with the same name if one exists (e.g. from an earlier failed save).
    const existing = guild.roles.cache.find((r) => !r.managed && r.name.toLowerCase() === button.label.toLowerCase());
    const role = existing ?? (await guild.roles.create({ name: button.label, reason: 'Wrenchy reaction role' }));
    assertAssignable(guild, role);
    button.roleId = role.id;
  }

  const ids = buttons.map((b) => b.roleId);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Each role can only be on one button.');
  rr.buttons = buttons;
}

const APPLY = { verification: applyVerification, reactionRoles: applyReactionRoles, roblox: applyRoblox };

const PANEL_REQUIREMENTS = {
  verification: (s) => (s.roleId ? null : 'Choose a verified role and save first.'),
  reactionRoles: (s) => (s.buttons.length ? null : 'Add at least one role button and save first.'),
};

function getKind(req) {
  const kind = PANEL_KINDS[req.params.kind];
  if (!kind) throw new HttpError(404, 'Unknown panel.');
  return kind;
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

  router.get('/guilds/:guildId/announcements', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await listAnnouncements(guild));
  });

  router.post('/guilds/:guildId/announcements', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await sendAnnouncement(guild, req.user, req.body ?? {}));
  });

  // Roblox Link: live data, update everyone
  router.get('/guilds/:guildId/roblox', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await robloxOverview(client, guild));
  });

  router.post('/guilds/:guildId/roblox/sync', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const result = await syncGuild(guild, await getGuildConfig(guild.id), { fresh: true });
    res.json({ ...result, notLinked: result.notLinked.length, ...(await robloxOverview(client, guild)) });
  });

  // Updates one member now, like /update
  router.post('/guilds/:guildId/roblox/update/:discordId', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const result = await updateOne(guild, await getGuildConfig(guild.id), req.params.discordId);
    res.json({ result, ...(await robloxOverview(client, guild)) });
  });

  // Team activity: who of the testers / staff last played and last chatted, and when
  router.get('/guilds/:guildId/team', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await teamOverview(guild));
  });

  router.put('/guilds/:guildId/team', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    await saveTeam(guild, req.body ?? {});
    res.json(await teamOverview(guild));
  });

  // Searches the server's members by name or ID (the dashboard's member pickers)
  router.get('/guilds/:guildId/members', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await searchMembers(guild, req.query.q, req.query.limit));
  });

  router.put('/guilds/:guildId/team/match', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    await matchMember(guild, req.body ?? {});
    res.json(await teamOverview(guild));
  });

  // Tickets: types, panels and settings; posting a panel; the tickets and their transcripts
  router.get('/guilds/:guildId/tickets/config', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await ticketsOverview(guild));
  });

  router.put('/guilds/:guildId/tickets/config', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const { warnings } = await saveTickets(guild, req.body ?? {});
    res.json({ warnings, ...(await ticketsOverview(guild)) });
  });

  router.post('/guilds/:guildId/tickets/panels/:panelId/post', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    await postTicketPanel(guild, req.params.panelId, req.body?.channelId);
    res.json(await ticketsOverview(guild));
  });

  router.get('/guilds/:guildId/tickets', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await listTickets(guild));
  });

  router.get('/guilds/:guildId/tickets/:ticketId', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await ticketTranscript(guild, req.params.ticketId));
  });

  // Managing the team: the Roblox bot account, adding, role changes, suspending / removing, records, notices
  router.get('/guilds/:guildId/team/admin', async (req, res) => {
    getGuild(client, req.params.guildId);
    res.json(await rankingInfo());
  });

  router.get('/guilds/:guildId/team/roblox-user', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await lookupRoblox(guild, req.query.username));
  });

  router.post('/guilds/:guildId/team/members', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const result = await addMember(guild, req.user, req.body ?? {});
    res.json({ result, team: await teamOverview(guild) });
  });

  router.post('/guilds/:guildId/team/role', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const result = await changeRole(guild, req.user, req.body ?? {});
    res.json({ result, team: await teamOverview(guild) });
  });

  router.post('/guilds/:guildId/team/take-off', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const result = await takeOff(guild, req.user, req.body ?? {});
    res.json({ result, team: await teamOverview(guild) });
  });

  router.post('/guilds/:guildId/team/reinstate/:recordId', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    const result = await reinstate(guild, req.user, req.params.recordId);
    res.json({ result, team: await teamOverview(guild) });
  });

  router.get('/guilds/:guildId/team/records', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await listRecords(guild, req.query));
  });

  router.get('/guilds/:guildId/team/notices', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await listNotices(guild));
  });

  router.post('/guilds/:guildId/team/notices', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(await sendNotice(guild, req.user, req.body ?? {}));
  });

  router.post('/guilds/:guildId/team/scan', async (req, res) => {
    const guild = getGuild(client, req.params.guildId);
    res.json(startScan(guild));
  });

  // Saves a panel's settings and updates the posted panel in place.
  router.put('/guilds/:guildId/:kind', async (req, res) => {
    const kind = getKind(req);
    const guild = getGuild(client, req.params.guildId);
    const guildConfig = await getGuildConfig(guild.id);
    await APPLY[kind](guild, guildConfig, req.body ?? {});

    // Edit the live panel before saving so an invalid emoji etc. doesn't get persisted.
    try {
      await refreshPanel(guild, guildConfig, kind);
    } catch (err) {
      throw new HttpError(400, `Discord rejected the panel (is every emoji valid?): ${err.message}`);
    }
    await guildConfig.save();
    // (new role bindings apply to everyone already linked)
    if (kind === 'roblox') {
      syncGuild(guild, guildConfig).catch((err) => console.error('[roblox] resync after save failed:', err));
    }
    res.json(await describeGuild(guild, guildConfig));
  });

  // Posts (or re-posts) a panel in a channel.
  router.post('/guilds/:guildId/:kind/panel', async (req, res) => {
    const kind = getKind(req);
    if (!PANEL_REQUIREMENTS[kind]) throw new HttpError(404, 'That page has no panel.');
    const guild = getGuild(client, req.params.guildId);
    const guildConfig = await getGuildConfig(guild.id);
    const notReady = PANEL_REQUIREMENTS[kind](guildConfig[kind]);
    if (notReady) throw new HttpError(400, notReady);

    const channel = guild.channels.cache.get(req.body?.channelId);
    if (!channel || !PANEL_CHANNEL_TYPES.includes(channel.type)) throw new HttpError(400, 'Pick a text channel.');
    const missing = channel.permissionsFor(guild.members.me).missing(['ViewChannel', 'SendMessages', 'EmbedLinks']);
    if (missing.length) throw new HttpError(400, `Wrenchy is missing ${missing.join(', ')} in #${channel.name}.`);

    try {
      await postPanel(guild, guildConfig, kind, channel);
    } catch (err) {
      throw new HttpError(400, `Discord rejected the panel (is every emoji valid?): ${err.message}`);
    }
    res.json(await describeGuild(guild, guildConfig));
  });

  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('[api] error:', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return router;
}
