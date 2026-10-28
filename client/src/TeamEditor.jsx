import { useEffect, useMemo, useState } from 'react';
import { rankByName } from '../../src/shared/search.js';
import { api } from './api.js';
import { useReportDirty } from './appContext.js';
import { RoleChips } from './PanelParts.jsx';
import {
  Badge, Button, Card, Empty, Field, FilterMenu, FilterSummary, Icon, PageHead, PageSkeleton, Popover, SaveBar, SearchInput,
  SearchList, Segmented, ago, day, useConfirm, useDebounced, useToast,
} from './ui.jsx';
import { useUrlState } from './urlState.js';

// Team: who of the testers and staff last played (the game reports it) and last chatted (Wrenchy notes when, never
// what), and who's gone quiet. One list for every group, with search, filters and sorting kept in the address; the
// groups, the inactive days and the history scan are under Settings.

function played(minutes) {
  if (!minutes) return 'no time yet';
  return minutes < 60 ? `${Math.round(minutes)}m played` : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h played`;
}

// ------------------------------------------------------------------ what each person is
const STATUSES = [
  { value: 'inactive', label: 'Inactive', test: (p) => p.inactiveGame || p.inactiveDiscord },
  { value: 'game', label: 'Not playing', test: (p) => p.inactiveGame },
  { value: 'discord', label: 'Not chatting', test: (p) => p.inactiveDiscord },
  { value: 'active', label: 'Active', test: (p) => !p.inactiveGame && !p.inactiveDiscord },
  { value: 'online', label: 'In game now', test: (p) => p.game?.online },
];

/** How their Roblox and Discord accounts were put together (or which one is missing). */
function accountOf(p) {
  if (!p.robloxId) return 'noRoblox';
  if (!p.discordId) return 'noDiscord';
  if (!p.inServer) return 'left';
  return p.matchedBy; // linked | matched | name
}
const ACCOUNTS = {
  linked: { label: 'Linked by Bloxlink', icon: 'link' },
  matched: { label: 'Matched by hand', icon: 'link' },
  name: { label: 'Matched by name', icon: 'link', hint: 'Their Discord name gives the Roblox username away' },
  noDiscord: { label: 'No Discord account', icon: 'alert' },
  noRoblox: { label: 'No Roblox account', icon: 'alert' },
  left: { label: 'Left the server', icon: 'alert' },
};
const ACCOUNT_FILTERS = [
  { value: 'missing', label: 'Missing an account', test: (a) => a === 'noDiscord' || a === 'noRoblox' },
  { value: 'noDiscord', label: 'No Discord account', test: (a) => a === 'noDiscord' },
  { value: 'noRoblox', label: 'No Roblox account', test: (a) => a === 'noRoblox' },
  { value: 'linked', label: 'Linked by Bloxlink', test: (a) => a === 'linked' },
  { value: 'matched', label: 'Matched by hand', test: (a) => a === 'matched' },
  { value: 'name', label: 'Matched by name', test: (a) => a === 'name' },
  { value: 'left', label: 'Left the server', test: (a) => a === 'left' },
];

function statusLabel(p) {
  if (p.game?.online) return 'Playing';
  if (p.inactiveGame && p.inactiveDiscord) return 'Inactive';
  if (p.inactiveGame) return 'Not playing';
  if (p.inactiveDiscord) return 'Quiet';
  return 'Active';
}
const STATUS_TONE = { Playing: 'ok', Active: 'ok', Inactive: 'bad', 'Not playing': 'warn', Quiet: 'warn' };

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

/** Everyone once, whichever groups they're in (someone can be a Tester and Staff). */
function mergePeople(groups) {
  const byKey = new Map();
  for (const g of groups) {
    for (const p of g.people) {
      const key = p.robloxId ? `r${p.robloxId}` : `d${p.discordId}`;
      const have = byKey.get(key);
      if (have) {
        have.groups.push(g.name);
        have.robloxRoles = [...new Set([...have.robloxRoles, ...p.robloxRoles])];
        have.discordRoles = [...new Set([...have.discordRoles, ...p.discordRoles])];
      } else {
        byKey.set(key, { ...p, key, groups: [g.name], account: accountOf(p) });
      }
    }
  }
  // (a group lists someone Discord-only when another group matched their Discord account: fold them in)
  const people = [...byKey.values()];
  const withRoblox = new Map(people.filter((p) => p.robloxId && p.discordId).map((p) => [p.discordId, p]));
  return people.filter((p) => {
    const same = !p.robloxId && withRoblox.get(p.discordId);
    if (!same) return true;
    same.groups = [...new Set([...same.groups, ...p.groups])];
    same.discordRoles = [...new Set([...same.discordRoles, ...p.discordRoles])];
    return false;
  });
}

const namesOf = (p) => [p.discordName, p.username, p.displayName, p.robloxId && String(p.robloxId), p.discordId];
// (the start of a name to look for look-alikes by: its first run of 3+ letters, "Bea2k_ph" -> "Bea")
const nameSeed = (s) => (s ?? '').replace(/\(.*$/, '').match(/[A-Za-z]{3,}/)?.[0] ?? '';

/** `list` with the ones named like `name` first. */
function similarFirst(list, name, names) {
  const word = nameSeed(name);
  if (!word) return list;
  const near = rankByName(list, word, names).map((r) => r.item);
  return [...near, ...list.filter((x) => !near.includes(x))];
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

// ------------------------------------------------------------------ matching accounts by hand
function MemberRow({ m }) {
  const sub = [m.username && `@${m.username}`, m.nickname && m.nickname !== m.displayName && m.nickname].filter(Boolean).join(' · ');
  return (
    <div className="pick-row">
      {m.avatar ? <img className="avatar-xs" src={m.avatar} alt="" /> : <span className="avatar-xs">{(m.displayName ?? '?')[0]}</span>}
      <span className="grow">
        {m.displayName}
        {sub && <small>{sub}</small>}
      </span>
      {m.linkedTo ? (
        <Badge tone="warn" title="Bloxlink linked them to another Roblox account">Linked to @{m.linkedTo}</Badge>
      ) : m.matched ? (
        <Badge tone="warn" title="Already matched to another Roblox account by hand">Matched</Badge>
      ) : (
        m.roles?.[0] && <span className="pill">{m.roles[0]}</span>
      )}
    </div>
  );
}

/** Find the Discord member a Roblox account belongs to: the whole server, searched on the server. */
function DiscordPicker({ guildId, p, spare, onPick }) {
  const [query, setQuery] = useState('');
  const typed = useDebounced(query.trim(), 200);
  // (with nothing typed: members named like the Roblox account)
  const ask = typed || nameSeed(p.username) || nameSeed(p.displayName);
  const [found, setFound] = useState({ for: null, results: [], total: 0, error: null });
  useEffect(() => {
    if (!ask) return undefined;
    let live = true;
    api(`/guilds/${guildId}/members?q=${encodeURIComponent(ask)}&limit=25`)
      .then((r) => live && setFound({ for: ask, ...r, error: null }))
      .catch((err) => live && setFound({ for: ask, results: [], total: 0, error: err.message }));
    return () => {
      live = false;
    };
  }, [ask]);
  const loading = Boolean(ask) && (found.for !== ask || query.trim() !== typed);
  const toItem = (m, section) => ({ key: `${section}${m.id}`, member: m, section, content: <MemberRow m={m} /> });
  let items;
  if (!query.trim()) {
    const fromSpare = similarFirst(spare, p.username, (s) => [s.discordName]).map((s) => ({
      id: s.discordId, displayName: s.discordName, avatar: s.discordAvatar, roles: s.discordRoles,
    }));
    const spareIds = new Set(fromSpare.map((m) => m.id));
    items = [
      ...fromSpare.map((m) => toItem(m, 'In a team group, no Roblox account')),
      ...(found.for === ask ? found.results.filter((m) => !spareIds.has(m.id)).map((m) => toItem(m, `Named like “${ask}”`)) : []),
    ];
  } else {
    items = found.for === typed ? found.results.map((m) => toItem(m)) : [];
  }
  const footer = found.error
    ? <span className="field-error">{found.error}</span>
    : query.trim() && found.for === typed && found.total > found.results.length
      ? `Showing the best ${found.results.length} of ${found.total}. Keep typing to narrow it down.`
      : !query.trim()
        ? 'Type a name, @username, nickname or Discord ID to search everyone.'
        : null;
  return (
    <div className="picker">
      <div className="picker-head">
        Who is <strong>@{p.username}</strong> on Discord?
      </div>
      <SearchList
        query={query}
        onQuery={setQuery}
        placeholder="Search members…"
        items={items}
        loading={loading}
        onPick={(it) => onPick(it.member)}
        empty={query.trim() ? `Nobody matches “${query.trim()}”. Try their username, nickname or ID.` : 'No suggestions. Type to search.'}
        footer={footer}
      />
    </div>
  );
}

/** Find the Roblox account a Discord-only member is: the group's Roblox accounts nobody's matched to yet. */
function RobloxPicker({ p, spareRoblox, onPick }) {
  const [query, setQuery] = useState('');
  const list = query.trim()
    ? rankByName(spareRoblox, query, (r) => [r.username, r.displayName, String(r.robloxId)]).map((x) => x.item)
    : similarFirst(spareRoblox, p.discordName, (r) => [r.username, r.displayName]);
  return (
    <div className="picker">
      <div className="picker-head">
        Which Roblox account is <strong>{p.discordName}</strong>?
      </div>
      <SearchList
        query={query}
        onQuery={setQuery}
        placeholder="Search Roblox usernames…"
        items={list.map((r) => ({
          key: r.robloxId,
          r,
          content: (
            <div className="pick-row">
              <span className="avatar-xs">{r.username[0]}</span>
              <span className="grow">
                {r.displayName ?? r.username}
                <small>@{r.username} · {r.robloxRoles.join(', ')}</small>
              </span>
            </div>
          ),
        }))}
        onPick={(it) => onPick(it.r)}
        empty={query.trim() ? `No unmatched group member called “${query.trim()}”.` : 'Every Roblox account in the groups has a Discord account.'}
        footer="Only Roblox accounts in the groups with no Discord account yet."
      />
    </div>
  );
}

function MatchButton({ label, variant, title, busy, children }) {
  return (
    <Popover
      align="end"
      className="picker-pop"
      label={label}
      trigger={(props) => (
        <Button size="sm" variant={variant} icon="link" disabled={busy} title={title} {...props}>
          {label}
        </Button>
      )}
    >
      {children}
    </Popover>
  );
}

function Actions({ p, guildId, spare, spareRoblox, busy, onMatch, onUnmatch }) {
  const pickDiscord = (close) => (
    <DiscordPicker guildId={guildId} p={p} spare={spare} onPick={(m) => (close(), onMatch(p, m.id, m.displayName))} />
  );
  if (p.account === 'noDiscord') return <MatchButton label="Match Discord" busy={busy}>{pickDiscord}</MatchButton>;
  if (p.account === 'name') {
    return (
      <MatchButton label="Change" variant="ghost" busy={busy} title="Wrong person? Pick their Discord account">
        {pickDiscord}
      </MatchButton>
    );
  }
  if (p.account === 'matched') {
    return (
      <Button size="sm" variant="ghost-danger" disabled={busy} onClick={() => onUnmatch(p)}>
        Unmatch
      </Button>
    );
  }
  if (p.account === 'noRoblox' && p.inServer && spareRoblox.length > 0) {
    return (
      <MatchButton label="Match Roblox" busy={busy}>
        {(close) => <RobloxPicker p={p} spareRoblox={spareRoblox} onPick={(r) => (close(), onMatch(r, p.discordId, p.discordName))} />}
      </MatchButton>
    );
  }
  return null;
}

function Person({ p, channels, showGroups, ...actions }) {
  const name = p.discordName ?? p.displayName ?? p.username;
  const account = ACCOUNTS[p.account];
  const missing = account.icon === 'alert';
  const status = statusLabel(p);
  const roles = [...new Set([...p.robloxRoles, ...p.discordRoles])].filter((r) => !p.groups.includes(r));
  const details = [...(showGroups ? p.groups : []), ...roles].join(' · ');
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
        <Actions p={p} {...actions} />
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

function People({ data, guild, guildId, busy, filters, setFilters, onMatch, onUnmatch, toast }) {
  const people = useMemo(() => mergePeople(data.groups), [data]);
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

  const spare = people.filter((p) => p.account === 'noRoblox' && p.inServer).sort((a, b) => a.discordName.localeCompare(b.discordName));
  const spareRoblox = people.filter((p) => p.account === 'noDiscord');

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
          <label className="sort-select">
            <Icon name="chevron" />
            <select value={sort} onChange={(e) => setFilters({ sort: e.target.value })} aria-label="Sort by">
              {SORT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
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
                guildId={guildId}
                spare={spare}
                spareRoblox={spareRoblox}
                busy={busy}
                onMatch={onMatch}
                onUnmatch={onUnmatch}
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
export default function TeamEditor({ guildId, onError }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [guild, setGuild] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [filters, setFilters] = useUrlState(FILTERS);

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

  const view = filters.view === 'settings' ? 'settings' : 'people';
  return (
    <>
      <PageHead title="Team" description="See who’s playing, who’s chatting, and who’s gone quiet.">
        <span className="subtle" title={loadedAt?.toLocaleTimeString()}>
          Updated {ago(loadedAt)}
        </span>
        <Button icon="refresh" loading={refreshing} onClick={refresh}>
          Refresh
        </Button>
      </PageHead>

      <div className="subnav">
        <Segmented
          label="Team view"
          value={view}
          onChange={(v) => setFilters({ view: v })}
          options={[
            { value: 'people', label: 'People' },
            { value: 'settings', label: 'Groups & tracking' },
          ]}
        />
      </div>

      <div className="stack">
        {view === 'people' && (
          <People
            data={data}
            guild={guild}
            guildId={guildId}
            busy={busy}
            filters={filters}
            setFilters={setFilters}
            onMatch={onMatch}
            onUnmatch={onUnmatch}
            toast={toast}
          />
        )}
        {view === 'settings' && <Tracking data={data} scanning={scanning} onScan={scan} />}
        {/* (kept mounted on People too, so unsaved group changes aren't lost and the save bar stays) */}
        <Settings
          hidden={view !== 'settings'}
          data={data}
          guild={guild}
          onSave={(form) => run(() => api(`/guilds/${guildId}/team`, { method: 'PUT', body: form }), { title: 'Saved', text: 'The list is rebuilt with the new groups.' })}
        />
      </div>
    </>
  );
}
