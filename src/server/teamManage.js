import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { DiscordActivity, PlayerActivity, TeamMatch } from '../models/Activity.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { Notice, TeamRecord } from '../models/TeamRecord.js';
import { forgetRoleMembers, getGroupRoles, getRobloxUser, resolveUsernames } from '../roblox/api.js';
import { chatStats, loadDaily, playStats, voiceStats } from '../team/roster.js';
import { RobloxBotError, acceptJoinRequest, botStatus, groupRoleOf, setGroupRole } from '../roblox/rankBot.js';
import { updateMember } from '../roblox/verified.js';
import { HttpError } from './errors.js';

// Managing the team from the dashboard: adding members, changing their Roblox role, suspending and removing them
// (their team roles come off on Roblox and Discord, their record stays), reinstating, and notices DMed to them.
// Roblox roles are changed by the studio's bot account (roblox/rankBot.js); Discord roles by Wrenchy.

const MAX_PEOPLE = 50; // (one suspend / remove)
const MAX_NOTICE_TO = 150;
const NOTICE_GAP_MS = 1200; // (between DMs: Discord frowns on bots DMing fast)
const NOTICE_STALE_MS = 10 * 60 * 1000;

const groupId = () => config.defaultRobloxGroupId;
const byOf = (user) => ({ id: user.id, name: user.name });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a bot account call; its failure becomes a 400 with Roblox's reason. */
async function asBot(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RobloxBotError) throw new HttpError(400, err.message);
    throw err;
  }
}

function manageable(guild, id) {
  const role = guild.roles.cache.get(id);
  return Boolean(role && !role.managed && role.position < guild.members.me.roles.highest.position);
}

/** Every Discord / Roblox role id that makes someone part of a team group. */
function teamRoleIds(team) {
  return {
    discord: new Set(team.groups.flatMap((g) => g.discordRoleIds)),
    roblox: new Set(team.groups.flatMap((g) => g.robloxRoleIds)),
  };
}

/** Their activity and roles right now, kept with each record. */
async function snapshotOf(guild, robloxId, member, robloxRole) {
  const [play, chat, daily] = await Promise.all([
    robloxId ? PlayerActivity.findOne({ robloxId }).lean() : null,
    member ? DiscordActivity.findOne({ guildId: guild.id, userId: member.id }).lean() : null,
    loadDaily(guild.id, member ? [member.id] : [], robloxId ? [robloxId] : []),
  ]);
  const c = member ? chatStats(daily.chatOf.get(member.id) ?? [], daily.days) : null;
  const g = robloxId ? playStats(daily.playOf.get(robloxId) ?? [], daily.days) : null;
  const v = member ? voiceStats(daily.chatOf.get(member.id) ?? [], daily.days) : null;
  return {
    voiceWeek: v?.withOthersWeek ?? null,
    voiceMonth: v?.withOthersMonth ?? null,
    messagesWeek: c?.week ?? null,
    messagesMonth: c?.month ?? null,
    chatDays: c?.activeDays ?? null,
    minutesWeek: g?.week ?? null,
    minutesMonth: g?.month ?? null,
    playDays: g?.activeDays ?? null,
    lastPlayedAt: play?.lastSeenAt ?? null,
    minutesPlayed: Math.round(play?.minutes ?? 0),
    sessions: play?.sessions ?? 0,
    lastMessageAt: chat?.lastMessageAt ?? null,
    messages: chat?.messages ?? 0,
    robloxRole: robloxRole?.name ?? null,
    discordRoles: member ? member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name) : [],
  };
}

/** A linked member's bound Discord roles follow their new Roblox role (as /update would). */
async function resyncLink(guild, gc, member, problems) {
  if (!member || !gc.roblox.enabled || !(await RobloxLink.exists({ discordId: member.id }))) return;
  try {
    const r = await updateMember(guild, gc.roblox, member);
    problems.push(...r.problems);
  } catch (err) {
    problems.push(`Roblox Link update failed: ${err.message}`);
  }
}

/**
 * What the bot account can do: { bot: { configured, ok, account, role, error }, roles: [{ id, name, rank, assignable }],
 * baseRole } (baseRole: the lowest role, given on suspending or removing).
 */
export async function rankingInfo() {
  const [bot, roles] = await Promise.all([botStatus(groupId()), getGroupRoles(groupId()).catch(() => [])]);
  const below = (r) => Boolean(bot.role && r.rank < bot.role.rank);
  const baseRole = [...roles].sort((a, b) => a.rank - b.rank)[0] ?? null;
  return { bot, roles: roles.map((r) => ({ ...r, assignable: below(r) })), baseRole };
}

/** A Roblox account by username, and its role in the group: { robloxId, username, displayName, role, linkedTo }. */
export async function lookupRoblox(guild, username) {
  const name = String(username ?? '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) throw new HttpError(400, 'A Roblox username is 3 to 20 letters, digits or underscores.');
  const account = (await resolveUsernames([name])).get(name.toLowerCase());
  if (!account) throw new HttpError(404, `No Roblox account called ${name}.`);
  const [role, link] = await Promise.all([
    groupRoleOf(groupId(), account.robloxId).catch(() => null),
    RobloxLink.findOne({ robloxId: account.robloxId }).lean(),
  ]);
  const linkedMember = link ? guild.members.cache.get(link.discordId) : null;
  return { ...account, role, linkedTo: link ? { discordId: link.discordId, name: linkedMember?.displayName ?? null } : null };
}

/** Adds someone to a team group: their Roblox role (accepting their join request if needed) and Discord roles. */
export async function addMember(guild, user, body) {
  const gc = await getGuildConfig(guild.id);
  const group = gc.team.groups.find((g) => g.name === body?.group);
  if (!group) throw new HttpError(400, 'Pick a team group.');
  const member = await guild.members.fetch(String(body.discordId ?? '')).catch(() => null);
  if (!member) throw new HttpError(400, 'Pick their Discord account (they need to be in this server).');
  const robloxId = Number(body.robloxId) || null;
  const roleId = Number(body.robloxRoleId) || null;
  if (group.robloxRoleIds.length && (!robloxId || !roleId)) throw new HttpError(400, 'Pick their Roblox account and role.');
  if (roleId && !group.robloxRoleIds.includes(roleId)) throw new HttpError(400, `That Roblox role isn't one of ${group.name}'s.`);

  const problems = [];
  let account = null;
  let from = null;
  let to = null;
  if (robloxId) {
    account = await getRobloxUser(robloxId);
    if (!account) throw new HttpError(400, 'That Roblox account no longer exists.');
  }
  if (robloxId && roleId) {
    const { roles } = await rankingInfo();
    const role = roles.find((r) => r.id === roleId);
    if (!role?.assignable) throw new HttpError(400, `The Roblox bot account can't give ${role?.name ?? 'that role'}: it needs a higher rank.`);
    let current = await asBot(() => groupRoleOf(groupId(), robloxId));
    if (!current) {
      try {
        await acceptJoinRequest(groupId(), robloxId);
      } catch {
        throw new HttpError(400, `@${account.username} isn't in the Roblox group yet. Ask them to join (or request to join), then try again.`);
      }
      current = await groupRoleOf(groupId(), robloxId).catch(() => null);
    }
    from = current?.name ?? 'Not in the group';
    if (current?.id !== roleId) await asBot(() => setGroupRole(groupId(), robloxId, roleId));
    to = role.name;
  }

  const give = group.discordRoleIds.filter((id) => !member.roles.cache.has(id));
  const blocked = give.filter((id) => !manageable(guild, id));
  if (blocked.length) problems.push(`Wrenchy can't give ${blocked.map((id) => `@${guild.roles.cache.get(id)?.name ?? 'a deleted role'}`).join(', ')}`);
  const giving = give.filter((id) => manageable(guild, id));
  if (giving.length) await member.roles.add(giving, `Team: added to ${group.name} by ${user.name}`);

  // (shown as one person on the Team tab, unless Bloxlink already links the account)
  if (robloxId && !(await RobloxLink.exists({ robloxId }))) {
    await TeamMatch.updateOne({ robloxId }, { $set: { discordId: member.id } }, { upsert: true });
  }
  forgetRoleMembers();
  await resyncLink(guild, gc, member, problems);
  await TeamRecord.create({
    guildId: guild.id, kind: 'added', robloxId, username: account?.username ?? null, discordId: member.id,
    discordName: member.displayName, group: group.name, from, to: to ?? group.name, by: byOf(user),
    snapshot: await snapshotOf(guild, robloxId, member, null), problems,
  });
  return { name: member.displayName, problems };
}

/** Gives a team member another Roblox role; their Discord team roles follow the groups that role is in. */
export async function changeRole(guild, user, body) {
  const gc = await getGuildConfig(guild.id);
  const robloxId = Number(body?.robloxId);
  if (!Number.isSafeInteger(robloxId) || robloxId <= 0) throw new HttpError(400, 'They have no Roblox account to change.');
  const { roles } = await rankingInfo();
  const role = roles.find((r) => r.id === Number(body.robloxRoleId));
  if (!role) throw new HttpError(400, 'Pick a role.');
  if (!role.assignable) throw new HttpError(400, `The Roblox bot account can't give ${role.name}: it needs a higher rank.`);
  const current = await asBot(() => groupRoleOf(groupId(), robloxId));
  if (!current) throw new HttpError(400, 'They are not in the Roblox group.');
  if (current.id === role.id) throw new HttpError(400, `They are already ${role.name}.`);
  if (!roles.find((r) => r.id === current.id)?.assignable) throw new HttpError(400, `The Roblox bot account can't change someone who is ${current.name}.`);

  const member = body.discordId ? await guild.members.fetch(String(body.discordId)).catch(() => null) : null;
  const snapshot = await snapshotOf(guild, robloxId, member, current);
  await asBot(() => setGroupRole(groupId(), robloxId, role.id));
  forgetRoleMembers();

  const problems = [];
  if (member) {
    // (the Discord roles of the groups the new role is in; off for groups only the old role was in)
    const want = new Set(gc.team.groups.filter((g) => g.robloxRoleIds.includes(role.id)).flatMap((g) => g.discordRoleIds));
    const drop = gc.team.groups
      .filter((g) => g.robloxRoleIds.includes(current.id))
      .flatMap((g) => g.discordRoleIds)
      .filter((id) => !want.has(id) && member.roles.cache.has(id) && manageable(guild, id));
    const add = [...want].filter((id) => !member.roles.cache.has(id) && manageable(guild, id));
    if (add.length) await member.roles.add(add, `Team: role changed by ${user.name}`);
    if (drop.length) await member.roles.remove(drop, `Team: role changed by ${user.name}`);
    await resyncLink(guild, gc, member, problems);
  }
  const account = await getRobloxUser(robloxId);
  await TeamRecord.create({
    guildId: guild.id, kind: 'role', robloxId, username: account?.username ?? null, discordId: member?.id ?? body.discordId ?? null,
    discordName: member?.displayName ?? null, from: current.name, to: role.name, reason: String(body.reason ?? '').trim().slice(0, 500),
    by: byOf(user), snapshot, problems,
  });
  return { from: current.name, to: role.name, problems };
}

/**
 * Suspends or removes people: their team role on Roblox becomes the group's lowest role, their team Discord roles come
 * off, and a record keeps what they had (a suspension can be undone with reinstate). people: [{ robloxId, discordId }].
 */
export async function takeOff(guild, user, body) {
  const kind = body?.kind;
  if (kind !== 'suspended' && kind !== 'removed') throw new HttpError(400, 'Suspend or remove?');
  const reason = String(body.reason ?? '').trim().slice(0, 500);
  if (!reason) throw new HttpError(400, 'Give a reason: it’s kept with their record.');
  const people = Array.isArray(body.people) ? body.people.slice(0, MAX_PEOPLE + 1) : [];
  if (!people.length) throw new HttpError(400, 'Pick at least one person.');
  if (people.length > MAX_PEOPLE) throw new HttpError(400, `At most ${MAX_PEOPLE} people at once.`);

  const gc = await getGuildConfig(guild.id);
  const team = teamRoleIds(gc.team);
  const info = people.some((p) => p.robloxId) ? await rankingInfo() : null;
  const results = [];
  for (const p of people) {
    const robloxId = Number(p.robloxId) || null;
    const member = p.discordId ? await guild.members.fetch(String(p.discordId)).catch(() => null) : null;
    const problems = [];
    let current = null;
    let previousRoleId = null;
    let to = null;
    if (robloxId) {
      try {
        current = await groupRoleOf(groupId(), robloxId);
        if (current && team.roblox.has(current.id)) {
          if (!info.baseRole) throw new Error('The group has no roles to move them to.');
          if (!info.roles.find((r) => r.id === current.id)?.assignable) throw new Error(`the Roblox bot account can't change someone who is ${current.name}`);
          await setGroupRole(groupId(), robloxId, info.baseRole.id);
          previousRoleId = current.id;
          to = info.baseRole.name;
        }
      } catch (err) {
        problems.push(`Roblox: ${err.message}`);
      }
    }
    const snapshot = await snapshotOf(guild, robloxId, member, current);
    const held = member ? [...team.discord].filter((id) => member.roles.cache.has(id)) : [];
    const removing = held.filter((id) => manageable(guild, id));
    if (held.length > removing.length) problems.push('Discord: Wrenchy can’t take some of their roles (they’re above its own)');
    if (removing.length) {
      await member.roles
        .remove(removing, `Team: ${kind} by ${user.name}: ${reason}`.slice(0, 500))
        .catch((err) => problems.push(`Discord: ${err.message}`));
    }
    await resyncLink(guild, gc, member, problems);
    const account = robloxId ? await getRobloxUser(robloxId) : null;
    const name = member?.displayName ?? account?.username ?? 'Someone';
    await TeamRecord.create({
      guildId: guild.id, kind, robloxId, username: account?.username ?? null, discordId: member?.id ?? p.discordId ?? null,
      discordName: member?.displayName ?? null, from: current?.name ?? null, to, reason, by: byOf(user), snapshot,
      previous: { robloxRoleId: previousRoleId, discordRoleIds: removing }, problems,
    });
    results.push({ name, problems });
  }
  forgetRoleMembers();
  return { results };
}

/** Gives a suspended person back what they had. */
export async function reinstate(guild, user, recordId) {
  const record = await TeamRecord.findOne({ _id: recordId, guildId: guild.id, kind: 'suspended', reinstatedAt: null }).catch(() => null);
  if (!record) throw new HttpError(404, 'That suspension is not active.');
  const problems = [];
  const info = await rankingInfo();
  const role = info.roles.find((r) => r.id === record.previous.robloxRoleId);
  if (record.robloxId && role) {
    if (!role.assignable) throw new HttpError(400, `The Roblox bot account can't give ${role.name}: it needs a higher rank.`);
    await asBot(() => setGroupRole(groupId(), record.robloxId, role.id));
  }
  const member = record.discordId ? await guild.members.fetch(record.discordId).catch(() => null) : null;
  if (member) {
    const back = record.previous.discordRoleIds.filter((id) => manageable(guild, id) && !member.roles.cache.has(id));
    if (back.length) await member.roles.add(back, `Team: reinstated by ${user.name}`);
    await resyncLink(guild, await getGuildConfig(guild.id), member, problems);
  } else if (record.discordId) {
    problems.push('They left the Discord server: no Discord roles given back');
  }
  forgetRoleMembers();
  record.reinstatedAt = new Date();
  await record.save();
  await TeamRecord.create({
    guildId: guild.id, kind: 'reinstated', robloxId: record.robloxId, username: record.username, discordId: record.discordId,
    discordName: member?.displayName ?? record.discordName, from: record.to, to: role?.name ?? record.from,
    by: byOf(user), snapshot: await snapshotOf(guild, record.robloxId, member, null), problems,
  });
  return { name: member?.displayName ?? record.username ?? 'They', problems };
}

/** The records, newest first; for one person when robloxId or discordId is given. */
export async function listRecords(guild, query) {
  const filter = { guildId: guild.id };
  const who = [];
  if (Number(query.robloxId)) who.push({ robloxId: Number(query.robloxId) });
  if (query.discordId) who.push({ discordId: String(query.discordId) });
  if (who.length) filter.$or = who;
  const rows = await TeamRecord.find(filter).sort({ createdAt: -1 }).limit(who.length ? 100 : 500).lean();
  return rows.map(({ _id, __v, ...r }) => ({ id: String(_id), ...r }));
}

// ------------------------------------------------------------------ notices (DMs)
function noticeEmbed(guild, notice, member) {
  return new EmbedBuilder()
    .setColor(0xf08c1a)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 64 }) ?? undefined })
    .setDescription(notice.message.replaceAll('{name}', member.displayName))
    .setFooter({ text: `Sent by ${notice.by.name}` })
    .setTimestamp();
}

/** DMs them one by one in the background, filling in the notice as it goes. */
async function deliver(guild, notice, ids) {
  const records = [];
  for (const [i, id] of ids.entries()) {
    const member = await guild.members.fetch(id).catch(() => null);
    let error = null;
    if (!member) error = 'Not in the server';
    else {
      try {
        await member.send({ embeds: [noticeEmbed(guild, notice, member)], allowedMentions: { parse: [] } });
      } catch (err) {
        error = err.code === 50007 ? 'Their DMs are closed' : err.message;
      }
    }
    if (error) notice.failed.push({ discordId: id, name: member?.displayName ?? id, error });
    else notice.sent += 1;
    records.push({
      // (the message as they got it, their name filled in)
      guildId: guild.id, kind: 'notice', discordId: id, discordName: member?.displayName ?? null,
      reason: member ? notice.message.replaceAll('{name}', member.displayName) : notice.message,
      by: notice.by, delivered: !error, problems: error ? [error] : [],
    });
    if (i % 5 === 4) await notice.save();
    if (i < ids.length - 1) await wait(NOTICE_GAP_MS);
  }
  notice.status = 'done';
  notice.finishedAt = new Date();
  await notice.save();
  await TeamRecord.insertMany(records);
}

/** Starts sending a notice: { message, discordIds, audience }. Returns it (it sends in the background). */
export async function sendNotice(guild, user, body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) throw new HttpError(400, 'Write the notice first.');
  if (message.length > 2000) throw new HttpError(400, 'A notice is at most 2,000 characters.');
  const ids = [...new Set((Array.isArray(body.discordIds) ? body.discordIds : []).map(String))].filter((id) => /^\d{5,25}$/.test(id));
  if (!ids.length) throw new HttpError(400, 'Nobody to send it to.');
  if (ids.length > MAX_NOTICE_TO) throw new HttpError(400, `At most ${MAX_NOTICE_TO} people per notice.`);
  const notice = await Notice.create({
    guildId: guild.id, message, audience: String(body.audience ?? '').slice(0, 200), by: byOf(user), total: ids.length,
  });
  deliver(guild, notice, ids).catch(async (err) => {
    console.error('[team] notice failed:', err);
    notice.status = 'done';
    notice.finishedAt = new Date();
    await notice.save().catch(() => {});
  });
  console.log(`[team] ${user.name} is sending a notice to ${ids.length} people in ${guild.name}`);
  return noticeOut(notice.toObject());
}

function noticeOut({ _id, __v, ...n }) {
  // (one left "sending" by a restart)
  const stopped = n.status === 'sending' && Date.now() - new Date(n.updatedAt).getTime() > NOTICE_STALE_MS;
  return { id: String(_id), ...n, status: stopped ? 'stopped' : n.status };
}

export async function listNotices(guild) {
  const rows = await Notice.find({ guildId: guild.id }).sort({ createdAt: -1 }).limit(30).lean();
  return rows.map(noticeOut);
}
