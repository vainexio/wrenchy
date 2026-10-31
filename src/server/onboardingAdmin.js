import crypto from 'node:crypto';
import { cancelGuide, deliverGuide, groupLinkOf, refreshGuide, startOnboarding } from '../bot/onboarding.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { Onboarding } from '../models/Onboarding.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { resolveUsernames } from '../roblox/api.js';
import { HttpError } from './errors.js';
import { placeInGroup } from './teamManage.js';

// The dashboard's side of onboarding (Team → Add members, Team → Onboarding): adding many people at once, everyone's
// progress, editing the guide, and resending / ranking / cancelling one. The guide itself is run by bot/onboarding.js.

const MAX_PEOPLE = 50;
const KINDS = ['verify', 'group', 'channels', 'info'];

function text(value, what, max, { required = false } = {}) {
  const t = typeof value === 'string' ? value.trim() : '';
  if (required && !t) throw new HttpError(400, `${what} can't be empty.`);
  if (t.length > max) throw new HttpError(400, `${what} must be at most ${max} characters.`);
  return t;
}

export async function onboardingOverview(guild) {
  const gc = await getGuildConfig(guild.id);
  const rows = await Onboarding.find({ guildId: guild.id }).sort({ createdAt: -1 }).limit(300).lean();
  return {
    guide: { ...gc.team.onboarding.toObject(), defaultGroupLink: groupLinkOf({ groupLink: '' }) },
    people: rows.map(({ _id, __v, ...o }) => {
      const member = guild.members.cache.get(o.discordId);
      return { id: String(_id), ...o, avatar: member?.user.displayAvatarURL({ size: 64 }) ?? null, inServer: Boolean(member) };
    }),
  };
}

/** Saves the guide: its intro, finish, community link, fallback channel and steps. */
export async function saveGuide(guild, body) {
  const gc = await getGuildConfig(guild.id);
  const o = gc.team.onboarding;
  const link = text(body?.groupLink, 'Community link', 300);
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new HttpError(400, 'The community link must start with https://');
  const fallback = body.fallbackChannelId || null;
  if (fallback && !guild.channels.cache.get(fallback)?.isTextBased()) throw new HttpError(400, 'The fallback channel no longer exists.');
  const raw = Array.isArray(body.steps) ? body.steps : [];
  if (raw.length > 10) throw new HttpError(400, 'At most 10 steps.');
  const ids = new Set();
  const steps = raw.map((s, i) => {
    const kind = KINDS.includes(s?.kind) ? s.kind : 'info';
    const title = text(s.title, `Step ${i + 1}: title`, 80, { required: true });
    if ((kind === 'verify' || kind === 'group') && raw.filter((x) => x?.kind === kind).length > 1) {
      throw new HttpError(400, `Only one ${kind === 'verify' ? 'verify' : 'join the community'} step.`);
    }
    let id = typeof s.id === 'string' && /^[a-z0-9]{3,16}$/.test(s.id) ? s.id : crypto.randomBytes(4).toString('hex');
    if (ids.has(id)) id = crypto.randomBytes(4).toString('hex');
    ids.add(id);
    return {
      id,
      kind,
      title,
      text: text(s.text, `${title}: text`, 1500),
      channelIds: [...new Set(Array.isArray(s.channelIds) ? s.channelIds : [])].filter((c) => guild.channels.cache.has(c)).slice(0, 15),
      button: text(s.button, `${title}: button`, 40) || 'Done',
    };
  });
  o.enabled = body.enabled !== false;
  o.intro = text(body.intro, 'Welcome text', 1000);
  o.finish = text(body.finish, 'Finish text', 1000);
  o.groupLink = link;
  o.fallbackChannelId = fallback;
  o.steps = steps;
  gc.markModified('team.onboarding');
  await gc.save();
}

/**
 * Adds people to a team group, ranking whoever can be ranked now and sending everyone the guide:
 * { people: [{ discordId, roblox? (username or id) }], group, robloxRoleId, sendGuide }. Returns a row per person.
 */
export async function onboardPeople(guild, user, body) {
  const gc = await getGuildConfig(guild.id);
  const group = gc.team.groups.find((g) => g.name === body?.group);
  if (!group) throw new HttpError(400, 'Pick a team group.');
  const roleId = Number(body.robloxRoleId) || null;
  if (group.robloxRoleIds.length && !group.robloxRoleIds.includes(roleId)) throw new HttpError(400, `Pick one of ${group.name}'s Roblox roles.`);
  const people = [...new Map((Array.isArray(body.people) ? body.people : []).map((p) => [String(p?.discordId ?? ''), p])).values()];
  if (!people.length) throw new HttpError(400, 'Pick at least one person.');
  if (people.length > MAX_PEOPLE) throw new HttpError(400, `At most ${MAX_PEOPLE} people at once.`);

  const names = people.map((p) => String(p.roblox ?? '').trim().replace(/^@/, '')).filter((n) => /^[A-Za-z0-9_]{3,20}$/.test(n) && !/^\d+$/.test(n));
  const accounts = names.length ? await resolveUsernames(names).catch(() => new Map()) : new Map();
  const results = [];
  for (const p of people) {
    const discordId = String(p.discordId);
    const member = /^\d{5,25}$/.test(discordId) ? await guild.members.fetch(discordId).catch(() => null) : null;
    if (!member) {
      results.push({ discordId, name: p.name ?? discordId, problem: 'Not in the server' });
      continue;
    }
    const given = String(p.roblox ?? '').trim().replace(/^@/, '');
    let robloxId = null;
    let note = null;
    if (/^\d+$/.test(given)) robloxId = Number(given);
    else if (given) {
      robloxId = accounts.get(given.toLowerCase())?.robloxId ?? null;
      if (!robloxId) note = `No Roblox account called ${given}`;
    }
    try {
      const row = await startOnboarding(guild, user, { member, group, roleId, robloxId, send: body.sendGuide !== false, gc });
      results.push({ ...row, problem: [note, row.problem].filter(Boolean).join('; ') || null });
    } catch (err) {
      console.error('[onboarding] adding failed:', err);
      results.push({ discordId, name: member.displayName, problem: err.message });
    }
  }
  console.log(`[onboarding] ${user.name} added ${results.length} people to ${group.name} in ${guild.name}`);
  return results;
}

async function recordOf(guild, id) {
  const record = await Onboarding.findOne({ _id: id, guildId: guild.id }).catch(() => null);
  if (!record) throw new HttpError(404, 'No such onboarding.');
  return record;
}

export async function resendGuide(guild, id) {
  const record = await recordOf(guild, id);
  if (record.status !== 'active') throw new HttpError(400, 'Their guide is finished.');
  const member = await guild.members.fetch(record.discordId).catch(() => null);
  if (!member) throw new HttpError(400, 'They left the server.');
  await deliverGuide(guild, await getGuildConfig(guild.id), record, member);
  return record.delivery;
}

export async function cancelOnboarding(guild, id) {
  const record = await recordOf(guild, id);
  if (record.status === 'active') await cancelGuide(guild, record);
}

/** Ranks someone now (the bot account was set up later, or they were stuck): their community step counts as done. */
export async function rankNow(guild, user, id) {
  const record = await recordOf(guild, id);
  const gc = await getGuildConfig(guild.id);
  const group = gc.team.groups.find((g) => g.name === record.group);
  if (!group) throw new HttpError(400, `The ${record.group} group no longer exists.`);
  const member = await guild.members.fetch(record.discordId).catch(() => null);
  if (!member) throw new HttpError(400, 'They left the server.');
  if (!record.robloxId) {
    const link = await RobloxLink.findOne({ discordId: member.id }).lean();
    if (link) Object.assign(record, { robloxId: link.robloxId, username: link.username });
  }
  if (!record.robloxId && group.robloxRoleIds.length) throw new HttpError(400, 'Their Roblox account isn’t known yet: they haven’t verified with Bloxlink.');
  try {
    await placeInGroup(guild, user, { member, group, robloxId: record.robloxId, roleId: record.robloxRoleId, gc });
  } catch (err) {
    if (err.code === 'not-in-group') throw new HttpError(400, `${member.displayName} hasn't joined the Roblox community yet.`);
    throw err;
  }
  Object.assign(record, { ranked: true, rankedAt: new Date(), note: '' });
  for (const s of record.steps) if (s.kind === 'group' && !s.doneAt) s.doneAt = new Date();
  if (record.status === 'active' && record.steps.every((s) => s.doneAt)) Object.assign(record, { status: 'done', completedAt: new Date() });
  await record.save();
  await refreshGuide(guild, gc, record, member);
  return member.displayName;
}
