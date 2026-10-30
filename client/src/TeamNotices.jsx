import { useEffect, useMemo, useState } from 'react';
import { rankByName } from '../../src/shared/search.js';
import { api } from './api.js';
import { renderMarkdown } from './PanelParts.jsx';
import { STATUSES, nameOf, namesOf, reachable } from './teamModel.js';
import { Badge, Button, Card, Empty, Field, FilterMenu, Popover, SearchList, Segmented, ago, useConfirm, useToast } from './ui.jsx';

// Notices: one message DMed to part of the team (a group, a type of people such as the inactive ones, or people
// picked by hand), from Wrenchy. Each DM is also kept under Records.

const MAX_TO = 150;

function AddPeople({ people, picked, onAdd }) {
  const [query, setQuery] = useState('');
  const pool = people.filter((p) => reachable(p) && !picked.includes(p.key));
  const found = (query.trim() ? rankByName(pool, query, namesOf).map((r) => r.item) : pool).slice(0, 40);
  return (
    <Popover
      label="Add people"
      className="picker-pop"
      trigger={(props) => (
        <button type="button" className="chip-add" {...props}>
          + Add people
        </button>
      )}
    >
      {() => (
        <SearchList
          query={query}
          onQuery={setQuery}
          placeholder="Search the team…"
          items={found.map((p) => ({
            key: p.key,
            p,
            content: (
              <div className="pick-row">
                {p.discordAvatar ? <img className="avatar-xs" src={p.discordAvatar} alt="" /> : <span className="avatar-xs">{nameOf(p)[0]}</span>}
                <span className="grow">
                  {nameOf(p)}
                  <small>{p.groups.join(' · ')}</small>
                </span>
              </div>
            ),
          }))}
          onPick={(it) => onAdd(it.p.key)}
          empty="Nobody else in the team can get DMs."
        />
      )}
    </Popover>
  );
}

function Progress({ n }) {
  if (n.status === 'sending') {
    const done = n.sent + n.failed.length;
    return (
      <div className="progress" title={`${done} of ${n.total}`}>
        <span className="subtle">Sending {done}/{n.total}</span>
        <div className="bar"><div style={{ width: `${(done / n.total) * 100}%` }} /></div>
      </div>
    );
  }
  if (n.status === 'stopped') return <Badge tone="warn">Stopped at {n.sent + n.failed.length}/{n.total}</Badge>;
  return n.failed.length ? <Badge tone="warn">{n.sent} of {n.total} delivered</Badge> : <Badge tone="ok">{n.sent} delivered</Badge>;
}

function NoticeRow({ n }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`record${open ? ' open' : ''}`}>
      <div className="record-main">
        <button type="button" className="record-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="grow record-text">
            <span className="notice-text">{n.message}</span>
            <span className="subtle">
              {n.audience || `${n.total} people`} · {n.by?.name} · {ago(n.createdAt)}
            </span>
          </span>
          <Progress n={n} />
        </button>
      </div>
      {open && (
        <div className="record-detail">
          <p className="record-message">{n.message}</p>
          {n.failed.length > 0 && (
            <>
              <p className="subtle">Not delivered:</p>
              <ul className="problems">
                {n.failed.map((f) => <li key={f.discordId}>{f.name}: {f.error}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function TeamNotices({ guildId, guild, data, people, preset, onError, onSent }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState(preset?.length ? 'pick' : 'filter');
  const [picked, setPicked] = useState(preset ?? []);
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState('');
  const [roles, setRoles] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (preset?.length) {
      setMode('pick');
      setPicked(preset);
    }
  }, [preset]);

  const loadHistory = () => api(`/guilds/${guildId}/team/notices`).then(setHistory).catch(onError);
  useEffect(() => {
    loadHistory();
  }, [guildId]);
  const sending = history?.some((n) => n.status === 'sending');
  useEffect(() => {
    if (!sending) return undefined;
    const id = setInterval(loadHistory, 2000);
    return () => clearInterval(id);
  }, [sending]);

  const allRoles = useMemo(() => [...new Set(people.flatMap((p) => [...p.robloxRoles, ...p.discordRoles]))].sort(), [people]);
  const matching = mode === 'pick'
    ? people.filter((p) => picked.includes(p.key))
    : people.filter(
      (p) =>
        (!groups.length || p.groups.some((g) => groups.includes(g))) &&
        (!status || STATUSES.find((s) => s.value === status)?.test(p)) &&
        (!roles.length || [...p.robloxRoles, ...p.discordRoles].some((r) => roles.includes(r))),
    );
  const unreachable = matching.filter((p) => !reachable(p));
  const recipients = matching.filter((p) => reachable(p) && !excluded.includes(p.key));
  const audience = mode === 'pick'
    ? `${recipients.length} picked ${recipients.length === 1 ? 'person' : 'people'}`
    : [groups.length ? groups.join(' + ') : 'Everyone', STATUSES.find((s) => s.value === status)?.label, ...roles].filter(Boolean).join(' · ');
  const sample = recipients[0] ? nameOf(recipients[0]) : 'Juan';
  const blocked = !recipients.length ? 'Nobody to send it to' : recipients.length > MAX_TO ? `At most ${MAX_TO} people per notice` : !message.trim() ? 'Write the notice' : null;

  async function send() {
    const ok = await confirm({
      title: `DM ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}?`,
      text: 'Each gets it as a private message from Wrenchy. It can’t be unsent.',
      confirmLabel: 'Send notice',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const notice = await api(`/guilds/${guildId}/team/notices`, {
        method: 'POST',
        body: { message, audience, discordIds: recipients.map((p) => p.discordId) },
      });
      toast({ tone: 'info', title: `Sending to ${notice.total} people`, text: 'One every second or so. Progress shows below.' });
      setMessage('');
      setExcluded([]);
      onSent();
      await loadHistory();
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Not sent', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card
        title="New notice"
        description="A private message from Wrenchy to part of the team."
        footer={
          <>
            <span className="grow subtle" style={{ alignSelf: 'center' }}>{blocked ?? `Goes to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} by DM`}</span>
            <Button variant="primary" icon="send" loading={busy} disabled={Boolean(blocked)} onClick={send}>
              Send notice
            </Button>
          </>
        }
      >
        <div className="split">
          <div>
            <Field label="Send to">
              <Segmented
                label="Who gets it"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setExcluded([]);
                }}
                options={[
                  { value: 'filter', label: 'A group or type' },
                  { value: 'pick', label: 'Pick people' },
                ]}
              />
            </Field>
            {mode === 'filter' ? (
              <div className="toolbar-group audience">
                {data.groups.length > 1 && (
                  <FilterMenu label="Group" multi value={groups} onChange={setGroups} anyLabel="Everyone"
                    options={data.groups.map((g) => ({ value: g.name, label: g.name }))} />
                )}
                <FilterMenu label="Who" value={status} onChange={setStatus} anyLabel="Anyone"
                  options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
                <FilterMenu label="Role" multi value={roles} onChange={setRoles} options={allRoles.map((r) => ({ value: r, label: r }))} />
              </div>
            ) : null}

            <div className="recipients">
              <div className="recipients-head">
                <b>{recipients.length}</b> {recipients.length === 1 ? 'person' : 'people'}
                {unreachable.length > 0 && <span className="subtle"> · {unreachable.length} can’t get DMs (no Discord account in the server)</span>}
              </div>
              <div className="chips">
                {(showAll ? recipients : recipients.slice(0, 8)).map((p) => (
                  <span key={p.key} className="chip person-chip">
                    {p.discordAvatar && <img src={p.discordAvatar} alt="" />}
                    {nameOf(p)}
                    <button
                      type="button"
                      aria-label={`Leave out ${nameOf(p)}`}
                      title="Leave out"
                      onClick={() => (mode === 'pick' ? setPicked(picked.filter((k) => k !== p.key)) : setExcluded([...excluded, p.key]))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {!showAll && recipients.length > 8 && (
                  <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
                    +{recipients.length - 8} more
                  </button>
                )}
                {mode === 'pick' && <AddPeople people={people} picked={picked} onAdd={(k) => setPicked([...picked, k])} />}
                {excluded.length > 0 && (
                  <button type="button" className="link-btn" onClick={() => setExcluded([])}>
                    Put back {excluded.length} left out
                  </button>
                )}
              </div>
            </div>

            <Field label="Message" max={2000} value={message} hint={<>Discord formatting works. <code>{'{name}'}</code> becomes each person’s name.</>}>
              <textarea rows={7} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={'Hi {name}! We haven’t seen you in the game for a while…'} />
            </Field>
          </div>

          <div>
            <div className="preview-label">
              <span>What {sample} sees</span>
            </div>
            <div className="discord">
              <div className="discord-embed" style={{ borderColor: '#f08c1a', marginTop: 0 }}>
                <div className="discord-embed-author">
                  {guild?.icon && <img src={guild.icon} alt="" />}
                  {guild?.name ?? 'Piyesa Studios'}
                </div>
                <div className="discord-embed-desc">
                  {message.trim() ? renderMarkdown(message.replaceAll('{name}', sample)) : <span className="placeholder">Your notice shows here…</span>}
                </div>
                <div className="discord-embed-footer">Sent by you · Today</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Sent notices" bodyClass="" aside={history?.length ? <Badge>{history.length}</Badge> : null}>
        {!history ? (
          <div className="skeleton" style={{ height: 80, margin: 16 }} />
        ) : !history.length ? (
          <Empty icon="chat" title="No notices yet">
            Notices you send show up here, with who got them.
          </Empty>
        ) : (
          <ul className="records">
            {history.map((n) => <NoticeRow key={n.id} n={n} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}
