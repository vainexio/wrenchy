import { useEffect, useState } from 'react';
import { matchScore } from '../../src/shared/search.js';
import { api } from './api.js';
import { hours, played } from './teamModel.js';
import { Badge, Button, Card, Empty, FilterMenu, FilterSummary, Icon, SearchInput, ago, day, useConfirm, useToast } from './ui.jsx';
import { useUrlState } from './urlState.js';

// Records: everything done on the Team pages, kept for good with a snapshot of the person's activity at the time,
// as proof if a suspension or removal is disputed. Suspended people can be reinstated from here.

export const KINDS = {
  added: { label: 'Added', tone: 'ok' },
  role: { label: 'Role changed', tone: 'accent' },
  suspended: { label: 'Suspended', tone: 'warn' },
  removed: { label: 'Removed', tone: 'bad' },
  reinstated: { label: 'Reinstated', tone: 'ok' },
  notice: { label: 'Notice', tone: '' },
};

const whoOf = (r) => r.discordName ?? (r.username ? `@${r.username}` : 'Someone');

function whatOf(r) {
  if (r.kind === 'notice') return r.delivered ? 'DM delivered' : `DM not delivered${r.problems?.[0] ? ` (${r.problems[0]})` : ''}`;
  if (r.from || r.to) return [r.from, r.to].filter(Boolean).join(' → ');
  return r.group ?? '';
}

/** One record; click it for the snapshot (their activity and roles at the time). `action`: a button beside it. */
export function RecordRow({ r, showWho = true, action }) {
  const [open, setOpen] = useState(false);
  const k = KINDS[r.kind] ?? { label: r.kind };
  const s = r.snapshot;
  return (
    <li className={`record${open ? ' open' : ''}`}>
      <div className="record-main">
        <button type="button" className="record-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Badge tone={k.tone}>{k.label}</Badge>
          <span className="grow record-text">
            <span className="record-line">
              {showWho && <strong>{whoOf(r)}</strong>}
              {showWho && r.discordName && r.username && <span className="subtle">@{r.username}</span>}
              <span className="muted">{whatOf(r)}</span>
            </span>
            {r.reason && <span className="record-reason">“{r.reason}”</span>}
          </span>
          <span className="subtle record-when" title={new Date(r.createdAt).toLocaleString()}>
            {r.by?.name} · {ago(r.createdAt)}
          </span>
          <Icon name="chevron" className={`record-chevron${open ? ' flip' : ''}`} />
        </button>
        {action}
      </div>
      {open && (
        <div className="record-detail">
          <div className="facts">
            <div><span>When</span><b>{new Date(r.createdAt).toLocaleString()}</b></div>
            <div><span>By</span><b>{r.by?.name ?? '—'}</b></div>
            {s && (
              <>
                <div><span>Last played then</span><b>{s.lastPlayedAt ? day(s.lastPlayedAt) : 'Never'}</b><small>{played(s.minutesPlayed)}</small></div>
                <div><span>Last message then</span><b>{s.lastMessageAt ? day(s.lastMessageAt) : 'Never'}</b><small>{s.messages} messages counted</small></div>
                {s.messagesWeek !== undefined && s.messagesWeek !== null && (
                  <div><span>Messages then</span><b>{s.messagesWeek} in 7 days</b><small>{s.messagesMonth} in 30 days, on {s.chatDays} days</small></div>
                )}
                {s.voiceWeek !== undefined && s.voiceWeek !== null && (
                  <div><span>Voice then</span><b>{hours(s.voiceWeek)} in 7 days</b><small>{hours(s.voiceMonth)} in 30 days, with others</small></div>
                )}
                {s.minutesWeek !== undefined && s.minutesWeek !== null && (
                  <div><span>Played then</span><b>{hours(s.minutesWeek)} in 7 days</b><small>{hours(s.minutesMonth)} in 30 days, on {s.playDays} days</small></div>
                )}
                <div><span>Roblox role then</span><b>{s.robloxRole ?? '—'}</b></div>
                <div><span>Discord roles then</span><b>{s.discordRoles?.length ? s.discordRoles.join(', ') : '—'}</b></div>
              </>
            )}
          </div>
          {r.kind === 'notice' && <p className="record-message">{r.reason}</p>}
          {r.reinstatedAt && <p className="subtle">Reinstated {ago(r.reinstatedAt)}.</p>}
          {r.problems?.length > 0 && r.kind !== 'notice' && (
            <ul className="problems">
              {r.problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

const PAGE = 60;

export default function TeamRecords({ guildId, onError, onTeam, reloadKey }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [records, setRecords] = useState(null);
  const [busy, setBusy] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const [f, setF] = useUrlState({ find: '', kinds: [] });

  const load = () => api(`/guilds/${guildId}/team/records`).then(setRecords).catch(onError);
  useEffect(() => {
    load();
  }, [guildId, reloadKey]);

  if (!records) return <div className="skeleton" style={{ height: 260 }} />;

  const suspended = records.filter((r) => r.kind === 'suspended' && !r.reinstatedAt);
  const shown = records.filter(
    (r) =>
      (!f.kinds.length || f.kinds.includes(r.kind)) &&
      (!f.find.trim() || matchScore([r.discordName, r.username, r.discordId, r.robloxId && String(r.robloxId), r.reason, r.by?.name], f.find) !== null),
  );
  const chips = [
    f.find.trim() && { key: 'find', label: `“${f.find.trim()}”`, onRemove: () => setF({ find: '' }) },
    ...f.kinds.map((k) => ({ key: k, label: KINDS[k].label, onRemove: () => setF({ kinds: f.kinds.filter((x) => x !== k) }) })),
  ].filter(Boolean);

  async function reinstate(r) {
    const ok = await confirm({
      title: r.kind === 'removed' ? `Undo removing ${whoOf(r)}?` : `Reinstate ${whoOf(r)}?`,
      text: `They get back ${r.from ?? 'their Roblox role'} on Roblox and their team roles on Discord.`,
      confirmLabel: 'Reinstate',
    });
    if (!ok) return;
    setBusy(r.id);
    try {
      const { result, team } = await api(`/guilds/${guildId}/team/reinstate/${r.id}`, { method: 'POST' });
      onTeam(team);
      toast(result.problems.length ? { tone: 'error', title: `Reinstated ${result.name}, with problems`, text: result.problems.join(' ') } : { title: `Reinstated ${result.name}` });
      await load();
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Couldn’t reinstate', text: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {suspended.length > 0 && (
        <Card title="Suspended now" description="Their team roles are off. Reinstating gives back exactly what they had." bodyClass="">
          <ul className="records">
            {suspended.map((r) => (
              <RecordRow
                key={r.id}
                r={r}
                action={
                  <Button size="sm" icon="undo" loading={busy === r.id} disabled={Boolean(busy)} onClick={() => reinstate(r)}>
                    Reinstate
                  </Button>
                }
              />
            ))}
          </ul>
        </Card>
      )}

      <Card title="History" description="Everything done to the team, newest first. Click one to see their activity at the time." bodyClass="">
        <div className="list-toolbar">
          <SearchInput value={f.find} onChange={(v) => setF({ find: v })} placeholder="Search a name, reason or who did it…" className="grow" />
          <FilterMenu
            label="Type"
            multi
            value={f.kinds}
            onChange={(v) => setF({ kinds: v })}
            options={Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label, count: records.filter((r) => r.kind === value).length }))}
          />
        </div>
        <FilterSummary shown={shown.length} total={records.length} noun="records" chips={chips} onClear={() => setF({ find: '', kinds: [] })} />
        {!records.length ? (
          <Empty icon="file" title="Nothing yet">
            Adding, role changes, suspensions, removals and notices show up here.
          </Empty>
        ) : !shown.length ? (
          <Empty icon="search" title="No records match" />
        ) : (
          <>
            <ul className="records">
              {shown.slice(0, limit).map((r) => (
                <RecordRow
                  key={r.id}
                  r={r}
                  action={
                    r.kind === 'removed' && !r.reinstatedAt ? (
                      <Button size="sm" icon="undo" loading={busy === r.id} disabled={Boolean(busy)} onClick={() => reinstate(r)} title="Give them back what they had">
                        Undo
                      </Button>
                    ) : null
                  }
                />
              ))}
            </ul>
            {shown.length > limit && (
              <div className="card-foot center">
                <Button variant="ghost" onClick={() => setLimit(limit + PAGE)}>
                  Show more ({shown.length - limit} left)
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
