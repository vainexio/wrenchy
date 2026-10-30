import { useEffect, useState } from 'react';
import { api } from './api.js';
import { RecordRow } from './TeamRecords.jsx';
import { ACCOUNTS, STATUS_TONE, nameOf, played, reachable, statusLabel } from './teamModel.js';
import { MatchActions } from './teamPickers.jsx';
import { Badge, Button, Field, Icon, Modal, Notice, ago, day, useToast } from './ui.jsx';

// One person, opened from the People list: their accounts, activity and history, and what can be done to them:
// change their Roblox role, send them a notice, suspend or remove them.

const TAKE_OFF = {
  suspended: { verb: 'Suspend', icon: 'pause', done: 'Suspended' },
  removed: { verb: 'Remove', icon: 'ban', done: 'Removed' },
};

/** Suspend or remove one or more people, with a reason (kept with their record). */
export function TakeOffDialog({ kind, people, guildId, admin, onClose, onTeam, onError }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const t = TAKE_OFF[kind];
  const one = people.length === 1;
  const anyRoblox = people.some((p) => p.robloxId);
  const names = people.slice(0, 6).map(nameOf).join(', ') + (people.length > 6 ? ` and ${people.length - 6} more` : '');

  async function submit() {
    setBusy(true);
    try {
      const { result, team } = await api(`/guilds/${guildId}/team/take-off`, {
        method: 'POST',
        body: { kind, reason, people: people.map((p) => ({ robloxId: p.robloxId, discordId: p.discordId })) },
      });
      onTeam(team);
      const trouble = result.results.filter((r) => r.problems.length);
      toast(
        trouble.length
          ? { tone: 'error', title: `${t.done} ${people.length}, ${trouble.length} with problems`, text: trouble.map((r) => `${r.name}: ${r.problems.join('; ')}`).join(' ') }
          : { title: `${t.done} ${one ? nameOf(people[0]) : `${people.length} people`}`, text: 'Their record is kept under Records.' },
      );
      onClose(true);
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: `Couldn’t ${t.verb.toLowerCase()}`, text: err.message });
      setBusy(false);
    }
  }

  return (
    <Modal
      title={one ? `${t.verb} ${nameOf(people[0])}?` : `${t.verb} ${people.length} people?`}
      onClose={() => !busy && onClose(false)}
      actions={
        <>
          <Button disabled={busy} onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button variant="danger" icon={t.icon} loading={busy} disabled={!reason.trim()} onClick={submit}>
            {t.verb}
          </Button>
        </>
      }
    >
      {!one && <p className="muted">{names}</p>}
      <ul className="consequences">
        {anyRoblox && admin?.bot.ok && <li>Their team role on Roblox becomes <b>{admin.baseRole?.name ?? 'the lowest role'}</b>.</li>}
        <li>Their team roles on Discord come off.</li>
        <li>Their record and activity are kept, as proof.</li>
        {kind === 'suspended' && <li>You can reinstate them later from Records.</li>}
      </ul>
      {anyRoblox && !admin?.bot.ok && (
        <Notice tone="warn">The Roblox bot account isn’t set up (Settings), so their Roblox role stays as it is.</Notice>
      )}
      <Field label="Reason" hint="Kept with their record. They don’t see it.">
        <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Inactive for 30 days, no reply to the notice" />
      </Field>
    </Modal>
  );
}

function RoleControl({ p, guildId, admin, onTeam, onError, onDone }) {
  const toast = useToast();
  const current = admin?.roles.find((r) => p.robloxRoles.includes(r.name));
  const [roleId, setRoleId] = useState(current?.id ?? '');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setRoleId(current?.id ?? ''), [current?.id]);
  if (!p.robloxId) return <p className="subtle">No Roblox account to give a role to.</p>;
  if (!admin) return <div className="skeleton" style={{ height: 38 }} />;
  if (!admin.bot.ok) return <p className="subtle">Set up the Roblox bot account under Settings to change roles from here.</p>;
  const picked = admin.roles.find((r) => r.id === Number(roleId));
  const canChangeThem = !current || current.assignable;

  async function submit() {
    setBusy(true);
    try {
      const { result, team } = await api(`/guilds/${guildId}/team/role`, {
        method: 'POST',
        body: { robloxId: p.robloxId, discordId: p.discordId, robloxRoleId: picked.id, reason },
      });
      onTeam(team);
      toast(result.problems.length
        ? { tone: 'error', title: `${result.from} → ${result.to}, with problems`, text: result.problems.join(' ') }
        : { title: `${nameOf(p)} is now ${result.to}`, text: `Was ${result.from}.` });
      setAsking(false);
      setReason('');
      onDone();
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Couldn’t change their role', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="role-control">
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Roblox role" disabled={!canChangeThem}>
          {!current && <option value="">Pick a role…</option>}
          {admin.roles.map((r) => (
            <option key={r.id} value={r.id} disabled={!r.assignable && r.id !== current?.id}>
              {r.name}
              {r.id === current?.id ? ' (now)' : ''}
            </option>
          ))}
        </select>
        <Button disabled={!picked || picked.id === current?.id} onClick={() => setAsking(true)}>
          Change
        </Button>
      </div>
      {!canChangeThem && <p className="hint">They rank at or above the bot account, so it can’t change them.</p>}
      {asking && (
        <Modal
          title={`Make ${nameOf(p)} ${picked.name}?`}
          onClose={() => !busy && setAsking(false)}
          actions={
            <>
              <Button disabled={busy} onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={submit}>
                Change role
              </Button>
            </>
          }
        >
          <p className="muted">
            On Roblox: {current?.name ?? 'their role'} → <b>{picked.name}</b>. Their Discord team roles follow.
          </p>
          <Field label="Note (optional)" hint="Kept with their record.">
            <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Promoted for great bug reports" />
          </Field>
        </Modal>
      )}
    </>
  );
}

export function PersonPanel({ p, guildId, admin, channels, matchProps, onClose, onTeam, onNotice, onTakeOff, onError }) {
  const [records, setRecords] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const qs = new URLSearchParams();
    if (p.robloxId) qs.set('robloxId', p.robloxId);
    if (p.discordId) qs.set('discordId', p.discordId);
    api(`/guilds/${guildId}/team/records?${qs}`).then(setRecords).catch(onError);
  }, [p.key, reload]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.dialog-backdrop') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const status = statusLabel(p);
  const account = ACCOUNTS[p.account];
  const channel = channels?.find((c) => c.id === p.discord?.lastChannelId);
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" aria-label={nameOf(p)}>
        <header className="drawer-head">
          {p.discordAvatar ? <img className="avatar-lg" src={p.discordAvatar} alt="" /> : <span className="avatar-lg">{nameOf(p)[0]}</span>}
          <div className="grow">
            <h2>{nameOf(p)}</h2>
            <div className="drawer-sub">
              <Badge tone={STATUS_TONE[status]}>{status}</Badge>
              <span className="subtle">{p.groups.join(' · ')}</span>
            </div>
          </div>
          <Button variant="ghost" icon="x" title="Close" onClick={onClose} />
        </header>

        <div className="drawer-body">
          <section>
            <h3>Accounts</h3>
            <div className="account-rows">
              <div className="account-row">
                <span className="account-kind">Roblox</span>
                {p.robloxId ? (
                  <span className="grow">
                    <a href={`https://www.roblox.com/users/${p.robloxId}/profile`} target="_blank" rel="noreferrer">@{p.username}</a>
                    {p.robloxRoles.length > 0 && <span className="subtle"> · {p.robloxRoles.join(', ')}</span>}
                  </span>
                ) : (
                  <span className="grow warn-text">None found</span>
                )}
              </div>
              <div className="account-row">
                <span className="account-kind">Discord</span>
                {p.discordId ? (
                  <span className="grow">
                    {p.discordName ?? 'Unknown'}
                    {!p.inServer && <span className="warn-text"> · left the server</span>}
                  </span>
                ) : (
                  <span className="grow warn-text">None found</span>
                )}
              </div>
              <div className="account-row joined-by">
                <span className="subtle">
                  <Icon name={account.icon} width="13" height="13" /> {account.label}
                </span>
                <MatchActions p={p} {...matchProps} />
              </div>
            </div>
          </section>

          <section>
            <h3>Activity</h3>
            <div className="facts">
              <div>
                <span>Last played</span>
                <b className={p.inactiveGame ? 'bad' : ''}>{!p.robloxId ? '—' : p.game?.online ? 'In game now' : p.game ? ago(p.game.lastSeenAt) : 'Never'}</b>
                <small>{p.game ? `${played(p.game.minutes)} · ${p.game.game}` : p.robloxId ? 'since tracking began' : ''}</small>
              </div>
              <div>
                <span>Last message</span>
                <b className={p.inactiveDiscord ? 'bad' : ''}>{!p.discordId ? '—' : p.discord?.lastMessageAt ? ago(p.discord.lastMessageAt) : 'Never'}</b>
                <small>{p.discord?.lastMessageAt ? `${day(p.discord.lastMessageAt)}${channel ? ` · #${channel.name}` : ''}` : ''}</small>
              </div>
            </div>
          </section>

          <section>
            <h3>Roblox role</h3>
            <RoleControl p={p} guildId={guildId} admin={admin} onTeam={onTeam} onError={onError} onDone={() => setReload((n) => n + 1)} />
          </section>

          <section>
            <h3>Actions</h3>
            <div className="drawer-actions">
              <Button icon="chat" disabled={!reachable(p)} title={reachable(p) ? undefined : 'They have no Discord account in the server'} onClick={() => onNotice([p])}>
                Send a notice
              </Button>
              <Button icon="pause" onClick={() => onTakeOff('suspended', [p])}>
                Suspend
              </Button>
              <Button variant="ghost-danger" icon="ban" onClick={() => onTakeOff('removed', [p])}>
                Remove
              </Button>
            </div>
          </section>

          <section>
            <h3>History</h3>
            {!records ? (
              <div className="skeleton" style={{ height: 60 }} />
            ) : !records.length ? (
              <p className="subtle">Nothing done to them from here yet.</p>
            ) : (
              <ul className="records compact">
                {records.map((r) => <RecordRow key={r.id} r={r} showWho={false} />)}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
