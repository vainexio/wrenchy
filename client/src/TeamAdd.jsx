import { useEffect, useState } from 'react';
import { api } from './api.js';
import { whyNotGivable } from './teamModel.js';
import { MemberSearch } from './teamPickers.jsx';
import { Badge, Button, Card, Field, Notice, Segmented, useToast } from './ui.jsx';

// Add member: pick their Discord account, find their Roblox account, pick the group and role. Wrenchy gives the
// Roblox role (through the bot account, accepting their join request if they sent one) and the group's Discord roles,
// and keeps a record.

/** The Roblox username a Discord member's nickname gives away ("Juan (@juan_ph)" -> "juan_ph"), if any. */
function usernameFrom(m) {
  if (m.linkedTo) return m.linkedTo;
  const nick = m.nickname ?? '';
  return nick.match(/@([A-Za-z0-9_]{3,20})/)?.[1] ?? nick.match(/\(([A-Za-z0-9_]{3,20})\)/)?.[1] ?? '';
}

function Step({ n, title, done, children }) {
  return (
    <section className={`step${done ? ' done' : ''}`}>
      <div className="step-head">
        <span className="step-n">{n}</span>
        <h3>{title}</h3>
      </div>
      <div className="step-body">{children}</div>
    </section>
  );
}

export default function TeamAdd({ guildId, guild, data, admin, people, onTeam, onError, onAdded, onSettings }) {
  const toast = useToast();
  const [member, setMember] = useState(null);
  const [username, setUsername] = useState('');
  const [lookup, setLookup] = useState({ loading: false, account: null, error: null });
  const [groupName, setGroupName] = useState(data.settings.groups[0]?.name ?? '');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);

  const group = data.settings.groups.find((g) => g.name === groupName);
  const groupRoles = (admin?.roles ?? []).filter((r) => group?.robloxRoleIds.includes(r.id)).sort((a, b) => a.rank - b.rank);
  const needsRoblox = Boolean(group?.robloxRoleIds.length);
  // (the group's lowest role the bot can give, unless one's picked)
  useEffect(() => setRoleId(groupRoles.find((r) => r.assignable)?.id ?? ''), [groupName, admin]);

  async function find(name = username) {
    if (!name.trim()) return;
    setLookup({ loading: true, account: null, error: null });
    try {
      const account = await api(`/guilds/${guildId}/team/roblox-user?username=${encodeURIComponent(name.trim())}`);
      setLookup({ loading: false, account, error: null });
    } catch (err) {
      onError(err);
      setLookup({ loading: false, account: null, error: err.message });
    }
  }

  function pickMember(m) {
    setMember(m);
    const guess = usernameFrom(m);
    setUsername(guess);
    setLookup({ loading: false, account: null, error: null });
    if (guess) find(guess);
  }

  const account = lookup.account;
  const already = member && people.find((p) => p.discordId === member.id);
  const role = groupRoles.find((r) => r.id === Number(roleId));
  const discordRoles = (group?.discordRoleIds ?? []).map((id) => guild?.roles.find((r) => r.id === id)?.name ?? 'deleted role');
  const blocked = !member
    ? 'Pick their Discord account'
    : needsRoblox && !admin?.bot.ok
      ? 'Set up the Roblox bot account first'
      : needsRoblox && !account
        ? 'Find their Roblox account'
        : needsRoblox && !role
          ? 'Pick a Roblox role'
          : null;

  async function add() {
    setBusy(true);
    try {
      const { result, team } = await api(`/guilds/${guildId}/team/members`, {
        method: 'POST',
        body: { discordId: member.id, robloxId: account?.robloxId, group: group.name, robloxRoleId: role?.id },
      });
      onTeam(team);
      toast(result.problems.length
        ? { tone: 'error', title: `Added ${result.name}, with problems`, text: result.problems.join(' ') }
        : { title: `Added ${result.name} to ${group.name}`, text: role ? `They’re ${role.name} on Roblox now.` : undefined });
      setMember(null);
      setUsername('');
      setLookup({ loading: false, account: null, error: null });
      onAdded(result.name);
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Couldn’t add them', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Add a team member"
      description="Gives them the group’s role on Roblox and Discord in one go."
      footer={
        <>
          <span className="grow subtle" style={{ alignSelf: 'center' }}>{blocked ?? `Adds ${member.displayName} to ${group.name}`}</span>
          <Button variant="primary" icon="userPlus" loading={busy} disabled={Boolean(blocked)} onClick={add}>
            Add to {group?.name ?? 'the team'}
          </Button>
        </>
      }
    >
      <div className="steps">
        <Step n={1} title="Their Discord account" done={Boolean(member)}>
          {member ? (
            <div className="picked">
              {member.avatar ? <img className="avatar-sm" src={member.avatar} alt="" /> : <span className="avatar-sm">{member.displayName[0]}</span>}
              <div className="grow">
                <strong>{member.displayName}</strong>
                <div className="subtle">{[member.username && `@${member.username}`, member.nickname].filter(Boolean).join(' · ')}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
                Change
              </Button>
            </div>
          ) : (
            <div className="inline-picker">
              <MemberSearch guildId={guildId} onPick={pickMember} />
            </div>
          )}
          {already && <p className="hint">Already in the team ({already.groups.join(', ')}).</p>}
        </Step>

        <Step n={2} title="Their Roblox account" done={Boolean(account)}>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              find();
            }}
          >
            <Field label="Roblox username" className="grow">
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. juan_ph" autoComplete="off" />
            </Field>
            <Button type="submit" loading={lookup.loading} disabled={!username.trim()}>
              Find
            </Button>
          </form>
          {lookup.error && <p className="field-error">{lookup.error}</p>}
          {account && (
            <div className="picked">
              <span className="avatar-sm">{account.username[0]}</span>
              <div className="grow">
                <strong>{account.displayName}</strong>{' '}
                <a href={`https://www.roblox.com/users/${account.robloxId}/profile`} target="_blank" rel="noreferrer">@{account.username}</a>
                <div className="subtle">
                  {account.role ? `In the group as ${account.role.name}` : <span className="warn-text">Not in the group yet: they need to join or ask to join first</span>}
                </div>
              </div>
              {account.linkedTo && account.linkedTo.discordId !== member?.id && (
                <Badge tone="warn" title="Bloxlink links this Roblox account to someone else">Linked to {account.linkedTo.name ?? 'another member'}</Badge>
              )}
            </div>
          )}
          {!needsRoblox && <p className="hint">{group?.name} has no Roblox roles, so this is optional.</p>}
        </Step>

        <Step n={3} title="Group and role" done={Boolean(group && (!needsRoblox || role))}>
          {data.settings.groups.length > 1 && (
            <Segmented label="Team group" value={groupName} onChange={setGroupName} options={data.settings.groups.map((g) => ({ value: g.name, label: g.name }))} />
          )}
          {needsRoblox && admin && !admin.bot.ok && (
            <Notice tone="warn">
              {admin.bot.configured
                ? admin.bot.error ?? 'The Roblox bot account isn’t signed in.'
                : 'No Roblox bot account is set up yet, so Wrenchy can’t give Roblox roles.'}{' '}
              <button type="button" className="link-btn" onClick={onSettings}>
                Open Settings
              </button>
            </Notice>
          )}
          {needsRoblox && (
            <Field label="Roblox role">
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {!groupRoles.length && <option value="">Loading roles…</option>}
                {groupRoles.map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.assignable}>
                    {r.name}
                    {r.assignable ? '' : ` (${whyNotGivable(admin, r)})`}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {discordRoles.length > 0 && (
            <p className="hint">
              On Discord they get {discordRoles.map((n) => `@${n}`).join(', ')}.
            </p>
          )}
        </Step>
      </div>
    </Card>
  );
}
