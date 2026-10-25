import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useReportDirty } from './appContext.js';
import { RoleChips } from './PanelParts.jsx';
import { Badge, Button, Card, Empty, Field, Icon, PageHead, PageSkeleton, SaveBar, Segmented, ago, day, useConfirm, useToast } from './ui.jsx';

// Team: who of the testers and staff last played (the game reports it) and last chatted (Wrenchy notes when, never
// what), and who's gone quiet. Groups and the inactive days are set at the bottom.

function played(minutes) {
  if (!minutes) return 'no time yet';
  return minutes < 60 ? `${Math.round(minutes)}m played` : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h played`;
}

const FILTERS = [
  { value: 'inactive', label: 'Inactive', test: (p) => p.inactiveGame || p.inactiveDiscord },
  { value: 'game', label: 'Not playing', test: (p) => p.inactiveGame },
  { value: 'discord', label: 'Not chatting', test: (p) => p.inactiveDiscord },
  { value: 'online', label: 'In game now', test: (p) => p.game?.online },
  { value: 'all', label: 'Everyone', test: () => true },
];

function searchHit(p, search) {
  if (!search) return true;
  const s = search.toLowerCase();
  return [p.username, p.displayName, p.discordName].some((n) => n?.toLowerCase().includes(s));
}

function GameCell({ p }) {
  if (!p.robloxId) return <div className="when"><span>No Roblox account found</span></div>;
  if (p.game?.online) {
    return (
      <div className="when">
        <b className="ok">● In game now</b>
        <span>{played(p.game.minutes)}</span>
      </div>
    );
  }
  if (!p.game) return <div className="when"><b className="bad">Not seen yet</b><span>since tracking began</span></div>;
  return (
    <div className="when" title={`${day(p.game.lastSeenAt)} · ${p.game.game}`}>
      <b className={p.inactiveGame ? 'bad' : ''}>{ago(p.game.lastSeenAt)}</b>
      <span>{played(p.game.minutes)}</span>
    </div>
  );
}

function DiscordCell({ p, channels }) {
  if (!p.discordId) return <div className="when"><span>No Discord account found</span></div>;
  if (!p.inServer) return <div className="when"><b className="bad">Left the server</b></div>;
  if (!p.discord?.lastMessageAt) return <div className="when"><b className="bad">No messages seen</b></div>;
  const channel = channels?.find((c) => c.id === p.discord.lastChannelId);
  return (
    <div className="when" title={day(p.discord.lastMessageAt)}>
      <b className={p.inactiveDiscord ? 'bad' : ''}>{ago(p.discord.lastMessageAt)}</b>
      {channel && <span>#{channel.name}</span>}
    </div>
  );
}

function StatusCell({ p }) {
  if (p.game?.online) return <Badge tone="ok">Playing</Badge>;
  if (p.inactiveGame && p.inactiveDiscord) return <Badge tone="bad">Inactive</Badge>;
  if (p.inactiveGame || p.inactiveDiscord) return <Badge tone="warn">{p.inactiveGame ? 'Not playing' : 'Quiet'}</Badge>;
  return <Badge tone="ok">Active</Badge>;
}

function Person({ p, channels, spare, busy, onMatch }) {
  const [picking, setPicking] = useState(false);
  const name = p.discordName ?? p.displayName ?? p.username;
  return (
    <div className="team-row">
      <div className="who">
        {p.discordAvatar ? <img className="avatar-sm" src={p.discordAvatar} alt="" /> : <span className="avatar-sm">{(name ?? '?')[0]}</span>}
        <div className="grow">
          <div className="who-names">
            <strong>{name}</strong>
            {p.username && (
              <a href={`https://www.roblox.com/users/${p.robloxId}/profile`} target="_blank" rel="noreferrer" title="Roblox profile">
                @{p.username}
              </a>
            )}
          </div>
          <div className="who-sub">
            {[...new Set([...p.robloxRoles, ...p.discordRoles])].map((r) => (
              <span key={r} className="pill">
                {r}
              </span>
            ))}
            {p.matchedBy === 'name' && <span className="subtle" title="Matched by their Discord name">· matched by name</span>}
            {p.matchedBy === 'matched' && (
              <Button size="sm" variant="ghost-danger" disabled={busy} onClick={() => onMatch(p, null)}>
                Unmatch
              </Button>
            )}
            {p.robloxId && !p.discordId && !picking && spare.length > 0 && (
              <Button size="sm" variant="ghost" icon="link" disabled={busy} onClick={() => setPicking(true)}>
                Match Discord
              </Button>
            )}
          </div>
          {picking && (
            <select
              className="match-pick"
              value=""
              autoFocus
              disabled={busy}
              onBlur={() => setPicking(false)}
              onChange={(e) => {
                if (e.target.value) onMatch(p, e.target.value);
                setPicking(false);
              }}
            >
              <option value="">Who is @{p.username} on Discord?</option>
              {spare.map((s) => (
                <option key={s.discordId} value={s.discordId}>
                  {s.discordName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div>
        <span className="cell-label">Last played</span>
        <GameCell p={p} />
      </div>
      <div>
        <span className="cell-label">Last message</span>
        <DiscordCell p={p} channels={channels} />
      </div>
      <div>
        <span className="cell-label">Status</span>
        <StatusCell p={p} />
      </div>
    </div>
  );
}

function Group({ group, channels, inactiveDays, busy, onMatch }) {
  const [filter, setFilter] = useState('inactive');
  const [search, setSearch] = useState('');
  const people = group.people;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, people.filter(f.test).length]));
  const test = FILTERS.find((f) => f.value === filter).test;
  const shown = people.filter((p) => test(p) && searchHit(p, search));
  // (Discord members of this group no Roblox account was found for: who an unmatched Roblox account could be)
  const spare = people.filter((p) => !p.robloxId && p.inServer).sort((a, b) => a.discordName.localeCompare(b.discordName));
  return (
    <Card
      title={group.name}
      description={`${people.length} people · ${counts.inactive} haven’t played or chatted in ${inactiveDays}+ days`}
      bodyClass=""
      aside={counts.online > 0 ? <Badge tone="ok" dot>{counts.online} in game now</Badge> : null}
    >
      <div className="team-toolbar">
        <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
        <input type="search" placeholder="Search a name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={`Search ${group.name}`} />
      </div>
      {shown.length === 0 ? (
        <Empty icon={filter === 'inactive' ? 'check' : 'search'} title={search ? 'Nobody by that name here' : filter === 'inactive' ? 'Everyone’s active' : 'Nobody here'}>
          {search ? 'Try another filter, or clear the search.' : null}
        </Empty>
      ) : (
        <>
          <div className="team-head" aria-hidden="true">
            <span>Person</span>
            <span>Last played</span>
            <span>Last message</span>
            <span>Status</span>
          </div>
          {shown.map((p) => (
            <Person key={p.robloxId ?? `d${p.discordId}`} p={p} channels={channels} spare={spare} busy={busy} onMatch={onMatch} />
          ))}
        </>
      )}
    </Card>
  );
}

function Settings({ data, guild, onSave }) {
  const [form, setForm] = useState(() => structuredClone(data.settings));
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(structuredClone(data.settings)), [data.settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const nudge = useReportDirty(dirty);
  const robloxRoles = data.groupRoles.map((r) => ({ id: String(r.id), name: r.name, problem: null }));
  const discordRoles = (guild?.roles ?? []).map((r) => ({ id: r.id, name: r.name, problem: null }));
  const setGroup = (i, changes) => setForm({ ...form, groups: form.groups.map((g, j) => (j === i ? { ...g, ...changes } : g)) });
  const days = Number(form.inactiveDays);
  const blocked = !Number.isInteger(days) || days < 1 || days > 90
    ? 'Inactive after must be 1 to 90 days'
    : form.groups.some((g) => !g.name.trim())
      ? 'Every group needs a name'
      : form.groups.some((g) => !g.robloxRoleIds.length && !g.discordRoleIds.length)
        ? 'Every group needs at least one role'
        : null;
  const save = async () => {
    setBusy(true);
    await onSave({ ...form, inactiveDays: days });
    setBusy(false);
  };
  return (
    <>
      <Card
        title="Groups and rules"
        description="Who counts in each group: anyone holding one of its Roblox roles in the group, or one of its Discord roles here."
        footer={
          <Button
            icon="plus"
            disabled={form.groups.length >= 8}
            onClick={() => setForm({ ...form, groups: [...form.groups, { name: 'New group', robloxRoleIds: [], discordRoleIds: [] }] })}
          >
            Add group
          </Button>
        }
      >
        <Field label="Inactive after" hint="Days without playing or chatting before someone shows as inactive.">
          <div className="row" style={{ alignItems: 'center' }}>
            <input type="number" min="1" max="90" aria-label="Inactive after (days)" value={form.inactiveDays} onChange={(e) => setForm({ ...form, inactiveDays: e.target.value })} className={blocked?.startsWith('Inactive') ? 'invalid' : ''} />
            <span className="muted">days</span>
          </div>
        </Field>
        {form.groups.map((g, i) => (
          <div key={i} className="team-group">
            <div className="team-group-head">
              <Field label="Group name" className="grow">
                <input value={g.name} maxLength={40} onChange={(e) => setGroup(i, { name: e.target.value })} className={!g.name.trim() ? 'invalid' : ''} />
              </Field>
              <Button variant="ghost-danger" icon="trash" disabled={form.groups.length < 2} onClick={() => setForm({ ...form, groups: form.groups.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            </div>
            <Field label="Roblox group roles">
              <RoleChips roles={robloxRoles} value={g.robloxRoleIds.map(String)} onChange={(ids) => setGroup(i, { robloxRoleIds: ids.map(Number) })} addLabel="Add Roblox role…" />
            </Field>
            <Field label="Discord roles">
              <RoleChips roles={discordRoles} value={g.discordRoleIds} onChange={(ids) => setGroup(i, { discordRoleIds: ids })} addLabel="Add Discord role…" />
            </Field>
          </div>
        ))}
      </Card>
      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={save} onDiscard={() => setForm(structuredClone(data.settings))} />
    </>
  );
}

function Tracking({ data, scanning, onScan }) {
  const { since, scan, game } = data;
  return (
    <Card
      title="Tracking"
      description={
        <>
          Game time since <strong>{day(since.game)}</strong> (the game reports group members as they play). Discord messages since{' '}
          <strong>{day(since.discord)}</strong>
          {since.scannedAt ? `, plus recent history scanned ${ago(since.scannedAt)}` : ''}. Only when they chatted is kept, never what they said.
        </>
      }
      aside={
        !game.keySet ? (
          <Badge tone="bad" dot>No GAME_API_KEY</Badge>
        ) : game.lastSeenAt ? (
          <Badge tone="ok" dot>Game connected {ago(game.lastSeenAt)}</Badge>
        ) : (
          <Badge dot>Game hasn’t reported yet</Badge>
        )
      }
    >
      <div className="row" style={{ alignItems: 'center' }}>
        <Button icon="refresh" loading={scanning} disabled={scan?.running} onClick={onScan}>
          {scan?.running ? `Scanning ${scan.done}/${scan.channels} channels…` : 'Scan Discord history'}
        </Button>
        <span className="subtle">
          {scan?.running
            ? `${scan.messages.toLocaleString()} messages read so far`
            : scan?.error
              ? `Last scan failed: ${scan.error}`
              : scan
                ? `Last scan read ${scan.messages.toLocaleString()} messages.`
                : 'Reads the newest 1,000 messages of every channel to fill in who chatted before tracking began.'}
        </span>
      </div>
    </Card>
  );
}

export default function TeamEditor({ guildId, onError }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [guild, setGuild] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = () => api(`/guilds/${guildId}/team`).then(setData).catch(onError);
  useEffect(() => {
    load();
    api(`/guilds/${guildId}`).then(setGuild).catch(onError);
  }, [guildId]);
  // (while a history scan runs, and every minute anyway: who's in game changes)
  useEffect(() => {
    const id = setInterval(load, data?.scan?.running ? 4000 : 60000);
    return () => clearInterval(id);
  }, [guildId, data?.scan?.running]);
  // (a scan that just finished)
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (wasRunning && data && !data.scan?.running) {
      toast(data.scan?.error ? { tone: 'error', title: 'History scan failed', text: data.scan.error } : { title: 'History scan done', text: `${data.scan.messages.toLocaleString()} messages read.` });
    }
    setWasRunning(Boolean(data?.scan?.running));
  }, [data?.scan?.running]);

  async function run(fn, success) {
    setBusy(true);
    try {
      setData(await fn());
      if (success) toast(success);
      return true;
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'That didn’t work', text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    if (!data) return null;
    const seen = new Map();
    for (const g of data.groups) for (const p of g.people) seen.set(p.robloxId ?? `d${p.discordId}`, p);
    const all = [...seen.values()];
    return {
      people: all.length,
      quiet: all.filter((p) => p.inactiveGame || p.inactiveDiscord).length,
      online: all.filter((p) => p.game?.online).length,
      unmatched: all.filter((p) => !p.robloxId || !p.discordId).length,
    };
  }, [data]);

  if (!data) return <PageSkeleton />;

  async function onMatch(p, discordId) {
    if (!discordId) {
      const ok = await confirm({ title: `Unmatch @${p.username}?`, text: 'Their Roblox and Discord accounts show separately again.', confirmLabel: 'Unmatch' });
      if (!ok) return;
    }
    run(() => api(`/guilds/${guildId}/team/match`, { method: 'PUT', body: { robloxId: p.robloxId, discordId } }), {
      title: discordId ? `Matched @${p.username}` : `Unmatched @${p.username}`,
    });
  }

  async function scan() {
    setScanning(true);
    await run(async () => {
      await api(`/guilds/${guildId}/team/scan`, { method: 'POST' });
      return api(`/guilds/${guildId}/team`);
    }, { tone: 'info', title: 'Scanning Discord history', text: 'This takes a few minutes. You can keep working.' });
    setScanning(false);
  }

  return (
    <>
      <PageHead title="Team" description="Who of your testers and staff last played and last chatted, and who’s gone quiet." />

      <div className="stat-grid">
        <section className={`card stat ${totals.quiet ? 'bad' : 'ok'}`}>
          <span className="stat-value">{totals.quiet}</span>
          <span className="stat-label">
            <Icon name="clock" width="14" height="14" /> Inactive {data.settings.inactiveDays}+ days
          </span>
        </section>
        <section className={`card stat ${totals.online ? 'ok' : ''}`}>
          <span className="stat-value">{totals.online}</span>
          <span className="stat-label">
            <Icon name="game" width="14" height="14" /> In game now
          </span>
        </section>
        <section className="card stat">
          <span className="stat-value">{totals.people}</span>
          <span className="stat-label">
            <Icon name="users" width="14" height="14" /> People tracked
          </span>
        </section>
        <section className="card stat">
          <span className="stat-value">{totals.unmatched}</span>
          <span className="stat-label" title="Only their Roblox or only their Discord account was found. Match them in the list.">
            <Icon name="link" width="14" height="14" /> Missing an account
          </span>
        </section>
      </div>

      <div className="stack">
        {data.groups.map((g) => (
          <Group key={g.name} group={g} channels={guild?.channels} inactiveDays={data.settings.inactiveDays} busy={busy} onMatch={onMatch} />
        ))}
        {!data.groups.length && <Empty title="No groups">Add one below.</Empty>}
        <Tracking data={data} scanning={scanning} onScan={scan} />
        <Settings
          data={data}
          guild={guild}
          onSave={(form) => run(() => api(`/guilds/${guildId}/team`, { method: 'PUT', body: form }), { title: 'Saved', text: 'The lists are rebuilt with the new groups.' })}
        />
      </div>
    </>
  );
}
