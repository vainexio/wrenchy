import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { getGuildConfig } from '../models/GuildConfig.js';
import { Onboarding } from '../models/Onboarding.js';
import { RobloxLink } from '../models/RobloxLink.js';
import { getGroupRoles, getRobloxUser } from '../roblox/api.js';
import { groupRoleOf } from '../roblox/rankBot.js';
import { isVerified, updateMember } from '../roblox/verified.js';
import { placeInGroup } from '../server/teamManage.js';

// ONBOARDING (the owner, 2026-10-31): someone added to the team gets a guide by DM, one step at a time, each with a
// Done button that's checked: "Step 1: Verify with Bloxlink, then there's a done button ... u verify if they have the
// verify role, step 2, join the community ... then rank them if they're not ranked yet, then auto update their role as
// if they did the /update command. Step 3, send them the channels to read". Steps they've already done are skipped
// ("step 2 will also be skipped if they're already ranked, step 1 as well, if they're already verified"). The steps are
// edited on the dashboard (Team → Onboarding).

export const ONBOARD_PREFIX = 'onboard:';
const ACCENT = 0xf08c1a;

export const groupLinkOf = (guide) => guide.groupLink || `https://www.roblox.com/communities/${config.defaultRobloxGroupId}`;

function fill(text, { member, group, guide }) {
  return String(text ?? '')
    .replaceAll('{user}', `${member}`)
    .replaceAll('{team}', group?.name ?? 'the')
    .replaceAll('{groupLink}', groupLinkOf(guide));
}

/**
 * What they've done already: { verified, robloxId, username, groupRole, ranked }. Ranked = they hold one of the group's
 * Roblox roles or a higher one (or the group has no Roblox roles: nothing to rank).
 */
export async function stateOf(gc, member, group, roleId, robloxIdHint = null) {
  const rc = gc.roblox;
  const verified = !rc.verifiedRoleId || isVerified(rc, member);
  let robloxId = robloxIdHint || null;
  if (!robloxId) robloxId = (await RobloxLink.findOne({ discordId: member.id }).lean())?.robloxId ?? null;
  const groupRole = robloxId ? await groupRoleOf(config.defaultRobloxGroupId, robloxId).catch(() => null) : null;
  let ranked = !group.robloxRoleIds.length;
  if (!ranked && groupRole) {
    const target = (await getGroupRoles(config.defaultRobloxGroupId).catch(() => [])).find((r) => r.id === roleId);
    ranked = group.robloxRoleIds.includes(groupRole.id) || Boolean(target && groupRole.rank >= target.rank);
  }
  const username = robloxId ? (await getRobloxUser(robloxId).catch(() => null))?.username ?? null : null;
  return { verified, robloxId, username, groupRole, ranked };
}

// ------------------------------------------------------------------ the guide message
/** The guide as it stands: the step they're on (with a warning if Done found it unfinished), or the finish. */
function guideMessage(guild, guide, record, member, group, warning = null) {
  const at = record.steps.findIndex((s) => !s.doneAt);
  const embed = new EmbedBuilder().setColor(ACCENT).setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 64 }) ?? undefined });
  const ctx = { member, group, guide };
  if (at === -1) {
    embed.setTitle('All done ✅').setDescription(fill(guide.finish, ctx) || 'You’re all set.');
    return { content: '', embeds: [embed], components: [] };
  }
  const state = record.steps[at];
  const step = guide.steps.find((s) => s.id === state.id) ?? { kind: state.kind, title: state.title, text: '', button: 'Done', channelIds: [] };
  const first = record.steps.every((s) => !s.doneAt);
  const parts = [];
  if (first && guide.intro) parts.push(fill(guide.intro, ctx));
  if (step.text) parts.push(fill(step.text, ctx));
  if (step.kind === 'channels' && step.channelIds.length) parts.push(step.channelIds.map((id) => `• <#${id}>`).join('\n'));
  if (warning) parts.push(`⚠️ ${warning}`);
  embed
    .setTitle(`Step ${at + 1} of ${record.steps.length} · ${step.title}`.slice(0, 256))
    .setDescription(parts.join('\n\n').slice(0, 4000) || null)
    .addFields({ name: 'Your progress', value: record.steps.map((s, i) => `${s.doneAt ? '✅' : i === at ? '➡️' : '⬜'} ${s.title}`).join('\n').slice(0, 1024) })
    .setFooter({ text: 'Press the button when you’ve done this step.' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ONBOARD_PREFIX}${record.id}:done`).setLabel((step.button || 'Done').slice(0, 80)).setStyle(ButtonStyle.Success),
  );
  if (step.kind === 'group') row.addComponents(new ButtonBuilder().setLabel('Open the community').setStyle(ButtonStyle.Link).setURL(groupLinkOf(guide)));
  return { content: '', embeds: [embed], components: [row] };
}

/** Sends (or re-sends) someone's guide: by DM, else in the fallback channel. Saves where it went. */
export async function deliverGuide(guild, gc, record, member) {
  const guide = gc.team.onboarding;
  const group = gc.team.groups.find((g) => g.name === record.group);
  const payload = guideMessage(guild, guide, record, member, group);
  // (the old message goes, so only one has live buttons)
  if (record.channelId && record.messageId) {
    const old = await guild.client.channels.fetch(record.channelId).catch(() => null);
    await old?.messages?.delete(record.messageId).catch(() => {});
  }
  try {
    const sent = await member.send(payload);
    Object.assign(record, { delivery: 'dm', channelId: sent.channelId, messageId: sent.id });
  } catch {
    const fallback = guide.fallbackChannelId ? guild.channels.cache.get(guide.fallbackChannelId) : null;
    const sent = fallback?.isTextBased()
      ? await fallback.send({ ...payload, content: `${member}`, allowedMentions: { users: [member.id] } }).catch(() => null)
      : null;
    if (sent) Object.assign(record, { delivery: 'channel', channelId: sent.channelId, messageId: sent.id });
    else Object.assign(record, { delivery: 'none', channelId: null, messageId: null, note: 'Their DMs are closed and there’s no fallback channel.' });
  }
  await record.save();
  return record;
}

// ------------------------------------------------------------------ starting one
/**
 * Adds one person to a team group and starts their guide. They're ranked right away when Wrenchy can (their Roblox
 * account is known and they're in the community); steps they've done already are left out. Returns a row for the
 * dashboard: { discordId, name, verified, username, inGroup, ranked, rankedNow, delivery, step, problem }.
 */
export async function startOnboarding(guild, by, { member, group, roleId, robloxId, send = true, gc }) {
  gc ??= await getGuildConfig(guild.id);
  const guide = gc.team.onboarding;
  const state = await stateOf(gc, member, group, roleId, robloxId);
  const row = {
    discordId: member.id, name: member.displayName, verified: state.verified, username: state.username,
    inGroup: Boolean(state.groupRole), ranked: state.ranked, rankedNow: false, delivery: 'none', step: null, problem: null,
  };
  // (rank them now when it's possible; when they're ranked already, it still gives the group's Discord roles)
  if (state.groupRole || !group.robloxRoleIds.length) {
    try {
      const placed = await placeInGroup(guild, by, { member, group, robloxId: state.robloxId, roleId, gc });
      row.rankedNow = Boolean(placed.ranked);
      row.ranked = true;
      if (placed.problems.length) row.problem = placed.problems.join('; ');
    } catch (err) {
      row.problem = err.message;
    }
  }

  await Onboarding.updateMany(
    { guildId: guild.id, discordId: member.id, status: 'active' },
    { $set: { status: 'cancelled', note: 'Replaced by a newer guide' } },
  );
  const steps = guide.steps
    .filter((s) => !(s.kind === 'verify' && state.verified) && !(s.kind === 'group' && row.ranked))
    .map((s) => ({ id: s.id, kind: s.kind, title: s.title, doneAt: null }));
  if (!send || !guide.enabled) return { ...row, step: row.ranked ? 'Done' : 'Not sent' };

  const record = await Onboarding.create({
    guildId: guild.id, discordId: member.id, discordName: member.displayName, group: group.name, robloxRoleId: roleId,
    robloxId: state.robloxId, username: state.username, steps, ranked: row.ranked, rankedAt: row.rankedNow ? new Date() : null,
    by: { id: by.id, name: by.name }, status: steps.length ? 'active' : 'done', completedAt: steps.length ? null : new Date(),
  });
  await deliverGuide(guild, gc, record, member);
  return { ...row, delivery: record.delivery, step: steps[0]?.title ?? 'Done', problem: row.problem ?? (record.delivery === 'none' ? record.note : null) };
}

// ------------------------------------------------------------------ Done
/** Checks the step they say they've done; moves them on (and edits the guide), or says what's missing. */
async function checkStep(guild, gc, record, member) {
  const group = gc.team.groups.find((g) => g.name === record.group);
  const at = record.steps.findIndex((s) => !s.doneAt);
  const step = record.steps[at];
  const linkFromNickname = async () => {
    if (!gc.roblox.enabled) return null;
    const r = await updateMember(guild, gc.roblox, member).catch(() => null);
    if (r?.link) Object.assign(record, { robloxId: r.link.robloxId, username: r.link.username });
    return r;
  };

  if (step.kind === 'verify') {
    if (gc.roblox.verifiedRoleId && !isVerified(gc.roblox, member)) {
      return 'I don’t see the Verified role yet. Verify with Bloxlink, then press the button again.';
    }
    await linkFromNickname();
  } else if (step.kind === 'group' && group?.robloxRoleIds.length) {
    // (Bloxlink usually linked them already: Wrenchy links Verified members as their nickname changes)
    if (!record.robloxId) {
      const link = await RobloxLink.findOne({ discordId: member.id }).lean();
      if (link) Object.assign(record, { robloxId: link.robloxId, username: link.username });
    }
    if (!record.robloxId) await linkFromNickname();
    if (!record.robloxId) {
      return 'I can’t tell which Roblox account is yours yet. Make sure Bloxlink set your nickname to your Roblox name, then press the button again.';
    }
    try {
      await placeInGroup(guild, record.by, { member, group, robloxId: record.robloxId, roleId: record.robloxRoleId, gc });
      Object.assign(record, { ranked: true, rankedAt: new Date() });
    } catch (err) {
      if (err.code === 'not-in-group') return 'You’re not in the community yet. Join it with the button below, then press Done again.';
      if (err.code !== 'no-bot') return err.message;
      // (Wrenchy can't rank anyone right now: they did their part, staff ranks them from the dashboard)
      record.note = 'Waiting for staff to rank them (the Roblox bot account isn’t set up).';
    }
  }
  step.doneAt = new Date();
  if (record.steps.every((s) => s.doneAt)) Object.assign(record, { status: 'done', completedAt: new Date() });
  return null;
}

export async function handleOnboarding(interaction) {
  const [, id] = interaction.customId.split(':');
  const record = await Onboarding.findById(id).catch(() => null);
  if (!record || record.status !== 'active') {
    return interaction.reply({ content: 'This guide is finished or no longer active.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== record.discordId) {
    return interaction.reply({ content: 'This guide is for someone else.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const guild = interaction.client.guilds.cache.get(record.guildId);
  const member = guild ? await guild.members.fetch({ user: record.discordId, force: true }).catch(() => null) : null;
  if (!member) return interaction.followUp({ content: 'You’re not in the server any more.', flags: MessageFlags.Ephemeral });
  const gc = await getGuildConfig(guild.id);
  let warning = null;
  record.note = '';
  try {
    warning = await checkStep(guild, gc, record, member);
  } catch (err) {
    console.error('[onboarding] a check failed:', err);
    warning = 'Something went wrong checking that. Try again in a moment.';
  }
  if (warning) record.note = warning;
  await record.save();
  const group = gc.team.groups.find((g) => g.name === record.group);
  return interaction.editReply(guideMessage(guild, gc.team.onboarding, record, member, group, warning));
}

/** Updates someone's guide message in place (after staff ranked them from the dashboard). */
export async function refreshGuide(guild, gc, record, member) {
  if (!record.channelId || !record.messageId) return;
  const channel = await guild.client.channels.fetch(record.channelId).catch(() => null);
  const message = await channel?.messages?.fetch(record.messageId).catch(() => null);
  const group = gc.team.groups.find((g) => g.name === record.group);
  await message?.edit(guideMessage(guild, gc.team.onboarding, record, member, group)).catch(() => {});
}

/** Ends someone's guide from the dashboard: its buttons go. */
export async function cancelGuide(guild, record) {
  record.status = 'cancelled';
  await record.save();
  if (record.channelId && record.messageId) {
    const channel = await guild.client.channels.fetch(record.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(record.messageId).catch(() => null);
    await message?.edit({ components: [], embeds: [new EmbedBuilder().setColor(0x80848e).setDescription('This guide was cancelled.')] }).catch(() => {});
  }
}

