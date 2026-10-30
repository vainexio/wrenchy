import { useEffect, useMemo, useState } from 'react';
import { rankByName } from '../../src/shared/search.js';
import { api } from './api.js';
import { useReportDirty } from './appContext.js';
import { RoleChips } from './PanelParts.jsx';
import TeamAdd from './TeamAdd.jsx';
import TeamNotices from './TeamNotices.jsx';
import { PersonPanel, TakeOffDialog } from './TeamPerson.jsx';
import TeamRecords from './TeamRecords.jsx';
import {
  ACCOUNTS, ACCOUNT_FILTERS, STATUSES, STATUS_TONE, mergePeople, nameOf, namesOf, played, reachable, statusLabel,
} from './teamModel.js';
import { MatchActions } from './teamPickers.jsx';
import {
  Badge, Button, Card, Check, Empty, Field, FilterMenu, FilterSummary, Icon, Notice, PageHead, PageSkeleton, SaveBar,
  SearchInput, Tabs, ago, day, useConfirm, useToast,
} from './ui.jsx';
import { useUrlState } from './urlState.js';

// Team: everyone in the testers and staff groups, when they last played (the game reports it) and chatted (Wrenchy
// notes when, never what), and managing them: add members, change their Roblox role, suspend or remove them (their
// record stays, as proof), and send them notices by DM. Sections: People, Add member, Notices, Records, Settings.

// (lower = shown first; nobody-seen counts as long ago)
const SORTS = {
  activity: { label: 'Least active first', key: (p) => -Math.min(p.gameDays ?? 1e6, p.discordDays ?? 1e6) },
  name: { label: 'Name', key: (p) => (p.discordName ?? p.displayName ?? p.username ?? '').toLowerCase() },
  played: { label: 'Last played', key: (p) => (p.game?.online ? -1 : (p.gameDays ?? 1e6)) },
  message: { label: 'Last message', key: (p) => p.discordDays ?? 1e6 },
  playtime: { label: 'Time played', key: (p) => -(p.game?.minutes ?? 0) },
};
const SORT_OPTIONS = [
  ['activity', 'Least active first'], ['-activity', 'Most active first'], ['name', 'Name A–Z'], ['-name', 'Name Z–A'],
  ['played', 'Played most recently'], ['-played', 'Played longest ago'], ['message', 'Chatted most recently'],
  ['-message', 'Chatted longest ago'], ['playtime', 'Most time played'], ['-playtime', 'Least time played'],
];

function sortPeople(list, sort) {
  const desc = sort.startsWith('-');
  const { key } = SORTS[sort.replace(/^-/, '')] ?? SORTS.activity;
  const name = SORTS.name.key;
  return list
    .map((p) => [key(p), p])
    .sort(([a, pa], [b, pb]) => (a < b ? -1 : a > b ? 1 : 0) * (desc ? -1 : 1) || name(pa).localeCompare(name(pb)))
    .map(([, p]) => p);
}

// ------------------------------------------------------------------ the cells
function GameCell({ p }) {
  if (!p.robloxId) return <div className="when"><span>—</span></div>;
  if (p.game?.online) {
    return (
      <div className="when">
        <b className="ok">● In game now</b>
        <span>{played(p.game.minutes)}</span>
      </div>
    );
  }
  if (!p.game) return <div className="when"><b className="bad">Never</b><span>since tracking began</span></div>;
  return (
    <div className="when" title={`${day(p.game.lastSeenAt)} · ${p.game.game}`}>
      <b className={p.inactiveGame ? 'bad' : ''}>{ago(p.game.lastSeenAt)}</b>
      <span>{played(p.game.minutes)}</span>
    </div>
  );
}

function DiscordCell({ p, channels }) {
  if (!p.discordId || !p.inServer) return <div className="when"><span>—</span></div>;
  if (!p.discord?.lastMessageAt) return <div className="when"><b className="bad">Never</b><span>no messages seen</span></div>;
  const channel = channels?.find((c) => c.id === p.discord.lastChannelId);
  return (
    <div className="when" title={day(p.discord.lastMessageAt)}>
      <b className={p.inactiveDiscord ? 'bad' : ''}>{ago(p.discord.lastMessageAt)}</b>
      {channel && <span>#{channel.name}</span>}
    </div>
  );
}

function Person({ p, channels, showGroups, selected, onSelect, onOpen, ...actions }) {
  const name = nameOf(p);
  const account = ACCOUNTS[p.account];
  const missing = account.icon === 'alert';
  const status = statusLabel(p);
  const roles = [...new Set([...p.robloxRoles, ...p.discordRoles])].filter((r) => !p.groups.includes(r));
  const details = [...(showGroups ? p.groups : []), ...roles].join(' · ');
  // (the row opens the person, except where its own links and buttons are pressed)
  const open = (e) => !e.target.closest('a, button, input, .popover') && onOpen(p);
  return (
    <div
      className={`team-row${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Open ${name}`}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(p)}
    >
      <div className="row-check">
        <Check checked={selected} onChange={onSelect} label={`Select ${name}`} />
      </div>
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
            {!missing && (
              <span className="joined" title={account.hint ? `${account.label}: ${account.hint.toLowerCase()}` : account.label}>
                <Icon name="link" />
                <span className="sr-only">{account.label}</span>
              </span>
            )}
          </div>
          <div className="who-sub" title={details}>
            {missing && <span className="warn-text">{account.label}</span>}
            {missing && details && ' · '}
            {details}
          </div>
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
        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
      </div>
      <div className="row-actions">
        <MatchActions p={p} {...actions} />
      </div>
    </div>
  );
}

function SortHead({ id, label, sort, onSort }) {
  const on = sort.replace(/^-/, '') === id;
  return (
    <button type="button" className={`sort-head${on ? ' on' : ''}`} onClick={() => onSort(on && !sort.startsWith('-') ? `-${id}` : id)}>
      {label}
      {on && <Icon name="chevron" className={sort.startsWith('-') ? 'flip' : ''} />}
    </button>
  );
}

function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Name', 'Roblox username', 'Roblox ID', 'Discord name', 'Discord ID', 'Groups', 'Accounts', 'Last played', 'Hours played', 'Last message', 'Status'];
  const lines = rows.map((p) => [
    p.discordName ?? p.displayName ?? p.username, p.username, p.robloxId, p.discordName, p.discordId, p.groups.join('; '),
    ACCOUNTS[p.account].label, p.game?.online ? 'now' : p.game?.lastSeenAt ?? '', p.game ? (p.game.minutes / 60).toFixed(1) : '',
    p.discord?.lastMessageAt ?? '', statusLabel(p),
  ]);
  return [head, ...lines].map((l) => l.map(cell).join(',')).join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FILTERS = { q: '', group: [], status: '', account: '', role: [], sort: 'activity', view: 'people' };

function People({ data, people, guild, busy, filters, setFilters, matchProps, selected, setSelected, onOpen, toast }) {
  const { q, group, status, account, role, sort } = filters;
  const groupNames = data.groups.map((g) => g.name);

  // (each filter's counts are with the other filters applied: what picking it would show)
  const tests = {
    q: (p) => !q.trim() || rankByName([p], q, namesOf).length > 0,
    group: (p) => !group.length || p.groups.some((g) => group.includes(g)),
    status: (p) => !status || STATUSES.find((s) => s.value === status)?.test(p),
    account: (p) => !account || ACCOUNT_FILTERS.find((a) => a.value === account)?.test(p.account),
    role: (p) => !role.length || [...p.robloxRoles, ...p.discordRoles].some((r) => role.includes(r)),
  };
  const passes = (p, skip) => Object.entries(tests).every(([k, t]) => k === skip || t(p));
  const countBy = (skip, test) => people.filter((p) => passes(p, skip) && test(p)).length;
  const shown = sortPeople(people.filter((p) => passes(p)), sort);
  const allRoles = [...new Set(people.flatMap((p) => [...p.robloxRoles, ...p.discordRoles]))].sort();

  const shownKeys = shown.map((p) => p.key);
  const allShownSelected = shown.length > 0 && shownKeys.every((k) => selected.includes(k));
  const someShownSelected = shownKeys.some((k) => selected.includes(k));
  const selectShown = (on) => setSelected(on ? [...new Set([...selected, ...shownKeys])] : selected.filter((k) => !shownKeys.includes(k)));

  const chips = [
    q.trim() && { key: 'q', label: `“${q.trim()}”`, onRemove: () => setFilters({ q: '' }) },
    ...group.map((g) => ({ key: `g${g}`, label: g, onRemove: () => setFilters({ group: group.filter((x) => x !== g) }) })),
    status && { key: 'status', label: STATUSES.find((s) => s.value === status)?.label ?? status, onRemove: () => setFilters({ status: '' }) },
    account && { key: 'account', label: ACCOUNT_FILTERS.find((a) => a.value === account)?.label ?? account, onRemove: () => setFilters({ account: '' }) },
    ...role.map((r) => ({ key: `r${r}`, label: r, onRemove: () => setFilters({ role: role.filter((x) => x !== r) }) })),
  ].filter(Boolean);
  const clearFilters = () => setFilters({ q: '', group: [], status: '', account: '', role: [] });

  const quick = (label, icon, value, tone, set) => {
    const on = Object.entries(set).every(([k, v]) => filters[k] === v) && chips.length === Object.keys(set).length;
    return (
      <button type="button" className={`card stat ${tone}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setFilters({ ...FILTERS, sort, view: 'people', ...set })}>
        <span className="stat-value">{value}</span>
        <span className="stat-label">
          <Icon name={icon} width="14" height="14" /> {label}
        </span>
      </button>
    );
  };
  const quiet = people.filter(STATUSES[0].test).length;
  const online = people.filter(STATUSES[4].test).length;
  const missing = people.filter((p) => ACCOUNT_FILTERS[0].test(p.account)).length;

  return (
    <>
      <div className="stat-grid">
        {quick(`Inactive ${data.settings.inactiveDays}+ days`, 'clock', quiet, quiet ? 'bad' : 'ok', { status: 'inactive' })}
        {quick('In game now', 'game', online, online ? 'ok' : '', { status: 'online' })}
        {quick('Missing an account', 'link', missing, missing ? 'warn' : '', { account: 'missing' })}
        {quick('Everyone', 'users', people.length, '', {})}
      </div>

      <Card bodyClass="">
        <div className="list-toolbar">
          <SearchInput
            value={q}
            onChange={(v) => setFilters({ q: v })}
            placeholder="Search name, @username or ID…"
            label="Search people"
            shortcut
            className="grow"
          />
          <div className="toolbar-group">
            {groupNames.length > 1 && (
              <FilterMenu label="Group" multi value={group} onChange={(v) => setFilters({ group: v })}
                options={groupNames.map((g) => ({ value: g, label: g, count: countBy('group', (p) => p.groups.includes(g)) }))} />
            )}
            <FilterMenu label="Status" value={status} onChange={(v) => setFilters({ status: v })}
              options={STATUSES.map((s) => ({ value: s.value, label: s.label, count: countBy('status', s.test) }))} />
            <FilterMenu label="Accounts" value={account} onChange={(v) => setFilters({ account: v })}
              options={ACCOUNT_FILTERS.map((a) => ({ value: a.value, label: a.label, count: countBy('account', (p) => a.test(p.account)) }))} />
            <FilterMenu label="Role" multi value={role} onChange={(v) => setFilters({ role: v })}
              options={allRoles.map((r) => ({ value: r, label: r, count: countBy('role', (p) => [...p.robloxRoles, ...p.discordRoles].includes(r)) }))} />
          </div>
        </div>
        <FilterSummary shown={shown.length} total={people.length} noun="people" chips={chips} onClear={clearFilters}>
          <FilterMenu label="Sort" quiet anyLabel={null} align="end" value={sort} onChange={(v) => setFilters({ sort: v })}
            options={SORT_OPTIONS.map(([v, l]) => ({ value: v, label: l }))} />
          <Button
            variant="ghost"
            icon="download"
            title="Download the people shown as a spreadsheet (CSV)"
            disabled={!shown.length}
            onClick={() => {
              download(`team-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(shown));
              toast({ title: `Exported ${shown.length} ${shown.length === 1 ? 'person' : 'people'}`, text: 'Saved as a CSV file.' });
            }}
          >
            Export
          </Button>
        </FilterSummary>

        {shown.length === 0 ? (
          <Empty icon={status === 'inactive' && chips.length === 1 ? 'check' : 'search'} title={status === 'inactive' && chips.length === 1 ? 'Everyone’s active' : 'Nobody matches'}>
            {chips.length > 0 && (
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </Empty>
        ) : (
          <>
            <div className="team-head">
              <div className="row-check">
                <Check checked={allShownSelected} indeterminate={!allShownSelected && someShownSelected} onChange={selectShown} label="Select everyone shown" />
              </div>
              <SortHead id="name" label="Person" sort={sort} onSort={(s) => setFilters({ sort: s })} />
              <SortHead id="played" label="Last played" sort={sort} onSort={(s) => setFilters({ sort: s })} />
              <SortHead id="message" label="Last message" sort={sort} onSort={(s) => setFilters({ sort: s })} />
              <SortHead id="activity" label="Status" sort={sort} onSort={(s) => setFilters({ sort: s })} />
              <span className="sr-only">Actions</span>
            </div>
            {shown.map((p) => (
              <Person
                key={p.key}
                p={p}
                channels={guild?.channels}
                showGroups={groupNames.length > 1}
                selected={selected.includes(p.key)}
                onSelect={(on) => setSelected(on ? [...selected, p.key] : selected.filter((k) => k !== p.key))}
                onOpen={onOpen}
                busy={busy}
                {...matchProps}
              />
            ))}
          </>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ settings
function Settings({ data, guild, onSave, hidden }) {
  const [form, setForm] = useState(() => structuredClone(data.settings));
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(structuredClone(data.settings)), [data.settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const nudge = useReportDirty(dirty);
  const robloxRoles = data.groupRoles.map((r) => ({ id: String(r.id), name: r.name, problem: null }));
  const discordRoles = (guild?.roles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color, problem: null }));
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
      <div hidden={hidden}>
        <Card
          title="Groups"
          description="Who’s in each group: anyone holding one of its Roblox roles in the group, or one of its Discord roles here."
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
      </div>
      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={save} onDiscard={() => setForm(structuredClone(data.settings))} />
    </>
  );
}

function BotAccount({ admin }) {
  const b = admin?.bot;
  return (
    <Card
      title="Roblox bot account"
      description="Wrenchy signs in as it to give and take Roblox roles when you add, change, suspend or remove someone."
      aside={!b ? null : b.ok ? <Badge tone="ok" dot>Connected</Badge> : b.configured ? <Badge tone="bad" dot>Not working</Badge> : <Badge dot>Not set up</Badge>}
    >
      {!b ? (
        <div className="skeleton" style={{ height: 40 }} />
      ) : b.ok ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Signed in as <b>@{b.account.name}</b>, <b>{b.role.name}</b> in the group. It can give:
          </p>
          <div className="chips">
            {admin.roles.filter((r) => r.assignable).map((r) => <span key={r.id} className="pill">{r.name}</span>)}
          </div>
        </>
      ) : (
        <>
          {b.error && <Notice tone="error">{b.error}</Notice>}
          <ol className="setup">
            <li>Put a Roblox account for Wrenchy in the group, ranked above the team roles, with permission to manage members.</li>
            <li>
              On the host (Render → Environment), add <code>ROBLOX_COOKIE</code> with that account’s cookie, then redeploy.
            </li>
          </ol>
        </>
      )}
    </Card>
  );
}

function Tracking({ data, scanning, onScan }) {
  const { since, scan, game } = data;
  return (
    <Card
      title="Tracking"
      description={
        <>
          Game time since <strong>{day(since.game)}</strong>, Discord messages since <strong>{day(since.discord)}</strong>
          {since.scannedAt ? ` (history scanned ${ago(since.scannedAt)})` : ''}. Only when someone chatted is kept, never what they said.
        </>
      }
      aside={
        !game.keySet ? (
          <Badge tone="bad" dot>Game not connected</Badge>
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
                : 'Reads the newest 1,000 messages of every channel, to fill in who chatted before tracking began.'}
        </span>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ the tab
const VIEWS = ['people', 'add', 'notices', 'records', 'settings'];

export default function TeamEditor({ guildId, onError }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [guild, setGuild] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [filters, setFilters] = useUrlState(FILTERS);
  const [selected, setSelected] = useState([]);
  const [openKey, setOpenKey] = useState(null);
  const [takeOff, setTakeOff] = useState(null); // { kind, people }
  const [noticeTo, setNoticeTo] = useState(null); // (people keys, from People)
  const [recordsKey, setRecordsKey] = useState(0);

  const setTeam = (d) => {
    setData(d);
    setLoadedAt(new Date());
    setRecordsKey((k) => k + 1);
  };
  const load = () =>
    api(`/guilds/${guildId}/team`)
      .then((d) => {
        setData(d);
        setLoadedAt(new Date());
      })
      .catch(onError);
  useEffect(() => {
    load();
    api(`/guilds/${guildId}`).then(setGuild).catch(onError);
    api(`/guilds/${guildId}/team/admin`).then(setAdmin).catch(onError);
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

  const people = useMemo(() => (data ? mergePeople(data.groups) : []), [data]);
  // (people who left the list, by a removal or a refresh, aren't selected any more)
  useEffect(() => {
    const keys = new Set(people.map((p) => p.key));
    setSelected((list) => list.filter((k) => keys.has(k)));
  }, [people]);

  async function run(fn, success) {
    setBusy(true);
    try {
      setData(await fn());
      setLoadedAt(new Date());
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

  if (!data) return <PageSkeleton />;

  // (robloxPerson: who has the Roblox account; discordName: for the toast)
  function onMatch(robloxPerson, discordId, discordName) {
    run(() => api(`/guilds/${guildId}/team/match`, { method: 'PUT', body: { robloxId: robloxPerson.robloxId, discordId } }), {
      title: `Matched @${robloxPerson.username} with ${discordName}`,
      text: 'They show as one person now. Unmatch any time.',
    });
  }

  async function onUnmatch(p) {
    const ok = await confirm({ title: `Unmatch @${p.username}?`, text: 'Their Roblox and Discord accounts show separately again.', confirmLabel: 'Unmatch', danger: true });
    if (!ok) return;
    run(() => api(`/guilds/${guildId}/team/match`, { method: 'PUT', body: { robloxId: p.robloxId, discordId: null } }), {
      title: `Unmatched @${p.username}`,
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

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const view = VIEWS.includes(filters.view) ? filters.view : 'people';
  const goto = (v) => setFilters({ view: v });
  const matchProps = {
    guildId,
    spare: people.filter((p) => p.account === 'noRoblox' && p.inServer).sort((a, b) => a.discordName.localeCompare(b.discordName)),
    spareRoblox: people.filter((p) => p.account === 'noDiscord'),
    busy,
    onMatch,
    onUnmatch,
  };
  const open = people.find((p) => p.key === openKey);
  const picked = people.filter((p) => selected.includes(p.key));
  const noticeFor = (list) => {
    setNoticeTo(list.filter(reachable).map((p) => p.key));
    setOpenKey(null);
    goto('notices');
  };

  return (
    <>
      <PageHead title="Team" description="Your testers and staff: who’s active, and everything to manage them.">
        <span className="subtle" title={loadedAt?.toLocaleTimeString()}>
          Updated {ago(loadedAt)}
        </span>
        <Button icon="refresh" loading={refreshing} onClick={refresh}>
          Refresh
        </Button>
      </PageHead>

      <Tabs
        label="Team sections"
        value={view}
        onChange={goto}
        tabs={[
          { value: 'people', label: 'People', icon: 'users', count: people.length },
          { value: 'add', label: 'Add member', icon: 'userPlus' },
          { value: 'notices', label: 'Notices', icon: 'chat' },
          { value: 'records', label: 'Records', icon: 'file' },
          { value: 'settings', label: 'Settings', icon: 'gear' },
        ]}
      />

      <div className="stack">
        {view === 'people' && (
          <People
            data={data}
            people={people}
            guild={guild}
            busy={busy}
            filters={filters}
            setFilters={setFilters}
            matchProps={matchProps}
            selected={selected}
            setSelected={setSelected}
            onOpen={(p) => setOpenKey(p.key)}
            toast={toast}
          />
        )}
        {view === 'add' && (
          <TeamAdd
            guildId={guildId}
            guild={guild}
            data={data}
            admin={admin}
            people={people}
            onTeam={setTeam}
            onError={onError}
            onAdded={(name) => setFilters({ ...FILTERS, sort: filters.sort, q: name })}
          />
        )}
        {view === 'notices' && (
          <TeamNotices guildId={guildId} guild={guild} data={data} people={people} preset={noticeTo} onError={onError} onSent={() => setRecordsKey((k) => k + 1)} />
        )}
        {view === 'records' && <TeamRecords guildId={guildId} onError={onError} onTeam={setTeam} reloadKey={recordsKey} />}
        {view === 'settings' && <BotAccount admin={admin} />}
        {view === 'settings' && <Tracking data={data} scanning={scanning} onScan={scan} />}
        {/* (kept mounted elsewhere too, so unsaved group changes aren't lost and the save bar stays) */}
        <Settings
          hidden={view !== 'settings'}
          data={data}
          guild={guild}
          onSave={(form) => run(() => api(`/guilds/${guildId}/team`, { method: 'PUT', body: form }), { title: 'Saved', text: 'The list is rebuilt with the new groups.' })}
        />
      </div>

      {view === 'people' && picked.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Selected people">
          <span className="bulkbar-text">
            <b>{picked.length}</b> selected
          </span>
          <Button size="sm" icon="chat" disabled={!picked.some(reachable)} onClick={() => noticeFor(picked)}>
            Send notice
          </Button>
          <Button size="sm" icon="pause" onClick={() => setTakeOff({ kind: 'suspended', people: picked })}>
            Suspend
          </Button>
          <Button size="sm" variant="ghost-danger" icon="ban" onClick={() => setTakeOff({ kind: 'removed', people: picked })}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" icon="x" title="Clear selection" onClick={() => setSelected([])} />
        </div>
      )}

      {open && (
        <PersonPanel
          p={open}
          guildId={guildId}
          admin={admin}
          channels={guild?.channels}
          matchProps={matchProps}
          onClose={() => setOpenKey(null)}
          onTeam={setTeam}
          onNotice={noticeFor}
          onTakeOff={(kind, list) => setTakeOff({ kind, people: list })}
          onError={onError}
        />
      )}

      {takeOff && (
        <TakeOffDialog
          kind={takeOff.kind}
          people={takeOff.people}
          guildId={guildId}
          admin={admin}
          onTeam={setTeam}
          onError={onError}
          onClose={(done) => {
            setTakeOff(null);
            if (done) {
              setSelected([]);
              setOpenKey(null);
            }
          }}
        />
      )}
    </>
  );
}
