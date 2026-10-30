import { useEffect, useMemo, useState } from 'react';
import { matchScore } from '../../src/shared/search.js';
import { api } from './api.js';
import { RoleChips, RoleOptions } from './PanelParts.jsx';
import {
  Badge, Button, Card, Empty, Field, FilterMenu, FilterSummary, PageHead, PageSkeleton, SaveBar, SearchInput, Toggle, ago, useToast,
} from './ui.jsx';
import { useGuildEditor } from './useGuildEditor.js';
import { useUrlState } from './urlState.js';

// ROBLOX LINK (the owner, 2026-10-25: "bloxlink handles the linking, which is an external bot, u just base it on their
// nicknames if they are verified and has the verified role"): pick the Verified role, bind Roblox group roles to
// Discord roles, see who's linked. Updates come from /update, /updateall, Update everyone and Bloxlink's own changes
// (src/roblox/verified.js): no timer, nothing from the game.

function toForm(guild) {
  const rc = guild.roblox;
  return {
    enabled: rc.enabled,
    linkedRoleId: rc.linkedRoleId ?? '',
    verifiedRoleId: rc.verifiedRoleId ?? '',
    bindings: rc.bindings.map((b) => ({ robloxRoleId: b.robloxRoleId, discordRoleIds: [...b.discordRoleIds] })),
  };
}

function RobloxRoleSelect({ value, roles, taken, onChange }) {
  // (everyone holds the member role: not useful to bind. A private role's members are hidden from the bot: not offered)
  const visible = roles.filter((r) => r.rank > 1 && !r.hidden);
  return (
    <select value={value || ''} onChange={(e) => onChange(Number(e.target.value))} aria-label="Roblox role" className={!value ? 'invalid' : ''}>
      <option value="">Pick a Roblox role…</option>
      {visible.map((r) => (
        <option key={r.id} value={r.id} disabled={taken.has(r.id) && r.id !== value}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

/** Bindings for the group roles that have a Discord role of the same name and no binding yet. */
function sameNameBindings(groupRoles, discordRoles, bindings) {
  const bound = new Set(bindings.map((b) => b.robloxRoleId));
  const key = (name) => name.trim().toLowerCase();
  const byName = new Map(discordRoles.filter((r) => !r.problem).map((r) => [key(r.name), r.id]));
  return groupRoles
    .filter((g) => g.rank > 1 && !g.hidden && !bound.has(g.id) && byName.has(key(g.name)))
    .map((g) => ({ robloxRoleId: g.id, discordRoleIds: [byName.get(key(g.name))] }));
}

// Members list: everyone linked, and the Verified members who can't be (their nickname names no account)
const STATUSES = [
  { value: 'roles', label: 'Linked, with group roles', test: (m) => m.linked && m.roles.length > 0 },
  { value: 'noroles', label: 'Linked, no bound group role', test: (m) => m.linked && !m.roles.length },
  { value: 'unreadable', label: 'Can’t be linked', test: (m) => !m.linked },
  { value: 'away', label: 'Not in this server', test: (m) => m.linked && !m.inServer },
];
const SORTS = [
  ['name', 'Name A–Z'], ['-name', 'Name Z–A'], ['rank', 'Highest group role'], ['updated', 'Updated most recently'], ['-updated', 'Updated longest ago'],
];
const SORT_KEYS = {
  name: (m) => m.discordName.toLowerCase(),
  rank: (m) => -Math.max(0, ...m.roles.map((r) => r.rank)),
  updated: (m) => -(m.syncedAt ? new Date(m.syncedAt).getTime() : 0),
};
const MEMBER_FILTERS = { q: '', status: '', role: [], sort: 'name' };

function membersOf(overview) {
  return [
    ...overview.links.map((l) => ({ ...l, linked: true })),
    ...overview.verified.unreadable.map((u) => ({
      ...u, linked: false, inServer: true, roles: [], robloxId: null, username: null, syncedAt: null,
      why: u.nickname ? 'Their nickname has no Roblox username in it' : 'They have no nickname',
    })),
  ];
}

function Members({ filters, setFilters, overview, guildId, syncing, onSync, onOverview, onError }) {
  const toast = useToast();
  const [updating, setUpdating] = useState(null);
  const { q, status, role, sort } = filters;
  const all = useMemo(() => membersOf(overview), [overview]);
  const tests = {
    q: (m) => !q.trim() || matchScore([m.discordName, m.nickname, m.username, m.displayName, m.discordId, m.robloxId && String(m.robloxId)], q) !== null,
    status: (m) => !status || STATUSES.find((s) => s.value === status)?.test(m),
    role: (m) => !role.length || m.roles.some((r) => role.includes(r.name)),
  };
  const passes = (m, skip) => Object.entries(tests).every(([k, t]) => k === skip || t(m));
  const countBy = (skip, test) => all.filter((m) => passes(m, skip) && test(m)).length;
  const key = SORT_KEYS[sort.replace(/^-/, '')] ?? SORT_KEYS.name;
  const dir = sort.startsWith('-') ? -1 : 1;
  const shown = all
    .filter((m) => passes(m))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * dir || a.discordName.localeCompare(b.discordName));
  const roleNames = [...new Set(overview.links.flatMap((l) => l.roles.map((r) => r.name)))];
  const chips = [
    q.trim() && { key: 'q', label: `“${q.trim()}”`, onRemove: () => setFilters({ q: '' }) },
    status && { key: 'status', label: STATUSES.find((s) => s.value === status)?.label ?? status, onRemove: () => setFilters({ status: '' }) },
    ...role.map((r) => ({ key: `r${r}`, label: r, onRemove: () => setFilters({ role: role.filter((x) => x !== r) }) })),
  ].filter(Boolean);
  const clear = () => setFilters({ q: '', status: '', role: [] });

  async function updateOne(m) {
    setUpdating(m.discordId);
    try {
      const { result: r, ...next } = await api(`/guilds/${guildId}/roblox/update/${m.discordId}`, { method: 'POST' });
      onOverview(next);
      const changes = [r.added.length && `Added ${r.added.join(', ')}.`, r.removed.length && `Removed ${r.removed.join(', ')}.`].filter(Boolean);
      toast(
        r.linkedTo
          ? { title: `Updated ${r.name}`, text: [`Linked to @${r.linkedTo}.`, ...(changes.length ? changes : ['Roles already up to date.']), ...r.problems].join(' ') }
          : { tone: 'error', title: `${r.name} isn’t linked`, text: r.why ?? 'Nothing links them to a Roblox account.' },
      );
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Update failed', text: err.message });
    } finally {
      setUpdating(null);
    }
  }

  return (
    <Card
      title="Members"
      description="Everyone linked, and Verified members whose nickname needs fixing (Bloxlink’s /update sets it)."
      bodyClass=""
      aside={
        <Button icon="refresh" loading={syncing} onClick={onSync} title="Recheck every Verified and linked member, like /updateall">
          Update everyone
        </Button>
      }
    >
      <div id="members" className="list-toolbar">
        <SearchInput value={q} onChange={(v) => setFilters({ q: v })} placeholder="Search name, @username or ID…" label="Search members" shortcut className="grow" />
        <div className="toolbar-group">
          <FilterMenu label="Status" value={status} onChange={(v) => setFilters({ status: v })}
            options={STATUSES.map((s) => ({ value: s.value, label: s.label, count: countBy('status', s.test) }))} />
          {roleNames.length > 0 && (
            <FilterMenu label="Group role" multi value={role} onChange={(v) => setFilters({ role: v })}
              options={roleNames.map((r) => ({ value: r, label: r, count: countBy('role', (m) => m.roles.some((x) => x.name === r)) }))} />
          )}
        </div>
      </div>
      <FilterSummary shown={shown.length} total={all.length} noun="members" chips={chips} onClear={clear}>
        <FilterMenu label="Sort" quiet anyLabel={null} align="end" value={sort} onChange={(v) => setFilters({ sort: v })}
          options={SORTS.map(([v, l]) => ({ value: v, label: l }))} />
      </FilterSummary>
      {!all.length ? (
        <Empty icon="link" title="Nobody is linked yet">
          Pick the Verified role and the bindings above, save, then press Update everyone.
        </Empty>
      ) : !shown.length ? (
        <Empty icon="search" title="Nobody matches">
          <Button size="sm" onClick={clear}>
            Clear filters
          </Button>
        </Empty>
      ) : (
        <ul className="list">
          {shown.map((m) => (
            <li key={m.discordId}>
              <div className="who">
                {m.discordAvatar ? <img className="avatar-sm" src={m.discordAvatar} alt="" /> : <span className="avatar-sm">{m.discordName[0]}</span>}
                <div className="grow">
                  <div className="who-names">
                    <strong>{m.discordName}</strong>
                    {m.username && (
                      <a href={`https://www.roblox.com/users/${m.robloxId}/profile`} target="_blank" rel="noreferrer">
                        @{m.username}
                      </a>
                    )}
                    {!m.inServer && <Badge tone="warn">Not in this server</Badge>}
                  </div>
                  <div className="who-sub">
                    {m.linked
                      ? m.roles.length
                        ? m.roles.map((r) => r.name).join(' · ')
                        : 'No bound group role'
                      : (
                        <>
                          <span className="warn-text">{m.why}</span>
                          {m.nickname ? ` · “${m.nickname}”` : ''}
                        </>
                      )}
                  </div>
                </div>
              </div>
              {m.linked && <span className="subtle when-updated">Updated {ago(m.syncedAt) ?? 'never'}</span>}
              {m.inServer && (
                <Button size="sm" icon="refresh" loading={updating === m.discordId} disabled={Boolean(updating) && updating !== m.discordId} onClick={() => updateOne(m)} title="Recheck their nickname and group roles now, like /update">
                  Update
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function RobloxEditor({ guildId, onError }) {
  const toast = useToast();
  const editor = useGuildEditor({ guildId, kind: 'roblox', toForm, onError });
  const { guild, form, setForm, dirty, busy, nudge } = editor;
  const [overview, setOverview] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [memberFilters, setMemberFilters] = useUrlState(MEMBER_FILTERS);

  useEffect(() => {
    api(`/guilds/${guildId}/roblox`).then(setOverview).catch(onError);
  }, [guildId]);

  if (!guild || !form) return <PageSkeleton error={editor.error} onRetry={editor.reload} />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setBinding = (i, changes) =>
    setForm({ ...form, bindings: form.bindings.map((b, j) => (j === i ? { ...b, ...changes } : b)) });
  const taken = new Set(form.bindings.map((b) => b.robloxRoleId));
  const incomplete = form.bindings.some((b) => !b.robloxRoleId || !b.discordRoleIds.length);
  const blocked = incomplete ? 'Each binding needs a Roblox role and a Discord role' : null;
  // (the counts are for the saved Verified role: hidden while another one is picked and not saved)
  const savedVerified = guild.roblox.verifiedRoleId ?? '';
  const showCounts = overview?.verified && savedVerified && form.verifiedRoleId === savedVerified;

  async function syncAll() {
    setSyncing(true);
    try {
      const d = await api(`/guilds/${guildId}/roblox/sync`, { method: 'POST' });
      setOverview(d);
      toast({ title: `Updated ${d.checked} member${d.checked === 1 ? '' : 's'}`, text: `${d.linked} linked, ${d.changed} had roles changed, ${d.unlinked} unlinked.` });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Update failed', text: err.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHead
        title="Roblox Link"
        description="Bloxlink verifies members; their Discord roles follow their roles in the Roblox group."
      >
        <Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label={form.enabled ? 'On' : 'Off'} />
      </PageHead>

      <div className="stack">
        <Card title="Bloxlink verification" description="Members with this role are linked to the Roblox username in their nickname.">
          <Field label="Verified role">
            <select value={form.verifiedRoleId} onChange={set('verifiedRoleId')}>
              <option value="">Off (nobody is linked)</option>
              {guild.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                </option>
              ))}
            </select>
          </Field>
          {showCounts && (
            <div className="row counts">
              <Badge tone="ok" dot>{overview.links.length} linked</Badge>
              {overview.verified.unreadable.length > 0 && (
                <Badge tone="bad" dot>{overview.verified.unreadable.length} can’t be linked</Badge>
              )}
              {overview.verified.unreadable.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMemberFilters({ status: 'unreadable' });
                    document.getElementById('members')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Show who and why
                </button>
              )}
            </div>
          )}
          <details className="howto">
            <summary>How linking works</summary>
            <p>
              The nickname just needs the Roblox username in it, whatever the format: “vai (@VA1_N)”, “VA1_N” and “vai | VA1_N” all
              link to VA1_N. Members are updated when they get the role or change their nickname, with <code>/update</code> (one
              member) and <code>/updateall</code> (everyone) in Discord, and with the Update buttons below. Lose the role and the
              bound roles come off.
            </p>
          </details>
        </Card>

        <Card
          title="Role sync"
          description="Each Roblox group role gives its Discord roles. Holding several group roles gives all of their bindings."
          footer={
            <div className="row">
              <Button icon="plus" onClick={() => setForm({ ...form, bindings: [...form.bindings, { robloxRoleId: 0, discordRoleIds: [] }] })}>
                Add binding
              </Button>
              {overview && (
                <Button
                  variant="ghost"
                  icon="link"
                  title="Adds a binding for every group role that has a Discord role of the same name"
                  onClick={() => {
                    const added = sameNameBindings(overview.groupRoles, guild.roles, form.bindings);
                    if (!added.length) {
                      toast({ title: 'Nothing to add', text: 'Every group role with a same-name Discord role is bound already.' });
                      return;
                    }
                    setForm({ ...form, bindings: [...form.bindings, ...added] });
                    toast({ title: `Added ${added.length} binding${added.length === 1 ? '' : 's'}`, text: 'Check them, then save.' });
                  }}
                >
                  Bind same names
                </Button>
              )}
            </div>
          }
        >
          {form.bindings.length === 0 ? (
            <Empty icon="link" title="No bindings yet">
              Add one to give a Discord role to everyone holding a Roblox role.
            </Empty>
          ) : (
            <div className="rows">
              {form.bindings.map((b, i) => (
                <div className="binding" key={i}>
                  {overview ? (
                    <RobloxRoleSelect value={b.robloxRoleId} roles={overview.groupRoles} taken={taken} onChange={(robloxRoleId) => setBinding(i, { robloxRoleId })} />
                  ) : (
                    <select disabled>
                      <option>Loading roles…</option>
                    </select>
                  )}
                  <span className="binding-arrow" aria-hidden="true">
                    →
                  </span>
                  <RoleChips roles={guild.roles} value={b.discordRoleIds} onChange={(discordRoleIds) => setBinding(i, { discordRoleIds })} addLabel="Add Discord role…" />
                  <Button
                    size="sm"
                    variant="ghost-danger"
                    icon="trash"
                    title="Remove binding"
                    onClick={() => setForm({ ...form, bindings: form.bindings.filter((_, j) => j !== i) })}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Role for everyone linked" description="Given to every verified, linked member, whatever their group roles.">
          <Field label="Role (optional)">
            <select value={form.linkedRoleId} onChange={set('linkedRoleId')}>
              <option value="">None</option>
              <RoleOptions roles={guild.roles} />
            </select>
          </Field>
        </Card>

        {overview ? (
          <Members filters={memberFilters} setFilters={setMemberFilters} overview={overview} guildId={guildId} syncing={syncing} onSync={syncAll} onOverview={setOverview} onError={onError} />
        ) : (
          <div className="skeleton" style={{ height: 160 }} />
        )}
      </div>

      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={() => editor.onSave(form)} onDiscard={editor.discard} />
    </>
  );
}
