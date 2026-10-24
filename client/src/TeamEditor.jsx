import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Loading, Notice, RoleChips } from './PanelParts.jsx';

// Team: who of the testers and staff last played (the game reports it) and last chatted (Wrenchy counts messages),
// and who's gone quiet. Groups and the inactive days are set at the bottom.

function ago(date) {
  if (!date) return null;
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function day(date) {
  return date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

function hours(minutes) {
  if (!minutes) return '0m played';
  return minutes < 60 ? `${Math.round(minutes)}m played` : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h played`;
}

const FILTERS = [
  ['inactive', 'Inactive'],
  ['game', 'Not playing'],
  ['discord', 'Not chatting'],
  ['online', 'In game now'],
  ['all', 'Everyone'],
];

function matches(p, filter, search) {
  if (search) {
    const s = search.toLowerCase();
    if (![p.username, p.displayName, p.discordName].some((n) => n?.toLowerCase().includes(s))) return false;
  }
  if (filter === 'inactive') return p.inactiveGame || p.inactiveDiscord;
  if (filter === 'game') return p.inactiveGame;
  if (filter === 'discord') return p.inactiveDiscord;
  if (filter === 'online') return p.game?.online;
  return true;
}

function GameCell({ p, inactiveDays }) {
  if (!p.robloxId) return <span className="muted">No Roblox account found</span>;
  if (p.game?.online) {
    return (
      <span className="status ok" title={p.game.game}>
        In game now
      </span>
    );
  }
  if (!p.game) return <span className={`status ${p.inactiveGame ? 'bad' : 'idle'}`}>Not seen yet</span>;
  return (
    <span className="activity">
      <span className={`status ${p.inactiveGame ? 'bad' : 'ok'}`} title={`${day(p.game.lastSeenAt)} · ${p.game.game}`}>
        {ago(p.game.lastSeenAt)}
      </span>
      <span className="muted">{hours(p.game.minutes)}</span>
    </span>
  );
}

function DiscordCell({ p, guild }) {
  if (!p.discordId) return <span className="muted">No Discord account found</span>;
  if (!p.inServer) return <span className="status bad">Not in the server</span>;
  if (!p.discord?.lastMessageAt) return <span className={`status ${p.inactiveDiscord ? 'bad' : 'idle'}`}>No messages seen</span>;
  const channel = guild?.channels.find((c) => c.id === p.discord.lastChannelId);
  return (
    <span className="activity">
      <span className={`status ${p.inactiveDiscord ? 'bad' : 'ok'}`} title={day(p.discord.lastMessageAt)}>
        {ago(p.discord.lastMessageAt)}
      </span>
      {channel && <span className="muted">#{channel.name}</span>}
    </span>
  );
}

function Person({ p, guild, inactiveDays, spare, busy, onMatch }) {
  const [picking, setPicking] = useState(false);
  return (
    <li className={p.inactiveGame || p.inactiveDiscord ? 'quiet' : ''}>
      <div className="link-who">
        {p.discordAvatar ? <img src={p.discordAvatar} alt="" /> : <span className="guild-icon">?</span>}
        <div className="grow">
          <div className="link-names">
            {p.discordName && <strong>{p.discordName}</strong>}
            {p.username ? (
              <a href={`https://www.roblox.com/users/${p.robloxId}/profile`} target="_blank" rel="noreferrer">
                @{p.username}
              </a>
            ) : null}
            {p.matchedBy === 'name' && <span className="muted" title="Matched by their Discord name">by name</span>}
            {p.matchedBy === 'matched' && (
              <button type="button" className="danger-text" disabled={busy} onClick={() => onMatch(p.robloxId, null)}>
                Unmatch
              </button>
            )}
            {p.robloxId && !p.discordId && !picking && (
              <button type="button" className="link-text" disabled={busy} onClick={() => setPicking(true)}>
                Match Discord
              </button>
            )}
          </div>
          {picking && (
            <select
              className="match-pick"
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) onMatch(p.robloxId, e.target.value);
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
          <div className="link-roles">
            {[...new Set([...p.robloxRoles, ...p.discordRoles])].map((r) => (
              <span key={r} className="role-pill">
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="team-cells">
        <div>
          <span className="field-label">Game</span>
          <GameCell p={p} inactiveDays={inactiveDays} />
        </div>
        <div>
          <span className="field-label">Discord</span>
          <DiscordCell p={p} guild={guild} />
        </div>
      </div>
    </li>
  );
}

function Group({ group, guild, inactiveDays, busy, onMatch }) {
  const [filter, setFilter] = useState('inactive');
  const [search, setSearch] = useState('');
  const people = group.people;
  const quiet = people.filter((p) => p.inactiveGame || p.inactiveDiscord).length;
  const online = people.filter((p) => p.game?.online).length;
  const shown = people.filter((p) => matches(p, filter, search));
  // (Discord members of this group no Roblox account was found for: who an unmatched Roblox account could be)
  const spare = people.filter((p) => !p.robloxId && p.inServer).sort((a, b) => a.discordName.localeCompare(b.discordName));
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          {group.name} <span className="muted">({people.length})</span>
        </h2>
        <span className="muted">
          {quiet} inactive{online ? ` · ${online} in game` : ''}
        </span>
      </div>
      <div className="row team-tools">
        <div className="segmented">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <input className="grow" type="search" placeholder="Search a name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {!shown.length && <p className="muted">Nobody here.</p>}
      <ul className="links team">
        {shown.map((p) => (
          <Person
            key={p.robloxId ?? `d${p.discordId}`}
            p={p}
            guild={guild}
            inactiveDays={inactiveDays}
            spare={spare}
            busy={busy}
            onMatch={onMatch}
          />
        ))}
      </ul>
    </section>
  );
}

function Settings({ data, guild, busy, onSave }) {
  const [form, setForm] = useState(() => structuredClone(data.settings));
  useEffect(() => setForm(structuredClone(data.settings)), [data.settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const robloxRoles = data.groupRoles.map((r) => ({ id: String(r.id), name: r.name, problem: null }));
  const discordRoles = (guild?.roles ?? []).map((r) => ({ id: r.id, name: r.name, problem: null }));
  const setGroup = (i, changes) => setForm({ ...form, groups: form.groups.map((g, j) => (j === i ? { ...g, ...changes } : g)) });
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <h2>Groups</h2>
      <p className="muted">
        Who counts as each group: anyone holding one of its Roblox roles in the group, or one of its Discord roles here.
      </p>
      <label className="field small-wide">
        <span>Inactive after (days without playing or chatting)</span>
        <input
          type="number"
          min="1"
          max="90"
          value={form.inactiveDays}
          onChange={(e) => setForm({ ...form, inactiveDays: Number(e.target.value) })}
        />
      </label>
      {form.groups.map((g, i) => (
        <div key={i} className="team-group">
          <div className="row">
            <label className="field grow">
              <span>Name</span>
              <input value={g.name} maxLength={40} onChange={(e) => setGroup(i, { name: e.target.value })} />
            </label>
            <button
              type="button"
              disabled={form.groups.length < 2}
              onClick={() => setForm({ ...form, groups: form.groups.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
          <div className="field">
            <span>Roblox group roles</span>
            <RoleChips
              roles={robloxRoles}
              value={g.robloxRoleIds.map(String)}
              onChange={(ids) => setGroup(i, { robloxRoleIds: ids.map(Number) })}
            />
          </div>
          <div className="field">
            <span>Discord roles</span>
            <RoleChips roles={discordRoles} value={g.discordRoleIds} onChange={(ids) => setGroup(i, { discordRoleIds: ids })} />
          </div>
        </div>
      ))}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          disabled={busy || form.groups.length >= 8}
          onClick={() => setForm({ ...form, groups: [...form.groups, { name: 'New group', robloxRoleIds: [], discordRoleIds: [] }] })}
        >
          Add group
        </button>
        {dirty && (
          <button type="button" disabled={busy} onClick={() => setForm(structuredClone(data.settings))}>
            Discard
          </button>
        )}
      </div>
    </form>
  );
}

function Tracking({ data, busy, onScan }) {
  const { since, scan, game } = data;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Tracking</h2>
        {!game.keySet ? (
          <span className="status bad">Bot has no GAME_API_KEY</span>
        ) : game.lastSeenAt ? (
          <span className="status ok">Game connected {ago(game.lastSeenAt)}</span>
        ) : (
          <span className="status idle">Game hasn’t reported since the bot started</span>
        )}
      </div>
      <p className="muted">
        Game time since <strong>{day(since.game)}</strong> (Mangingisda reports group members as they play). Discord
        messages since <strong>{day(since.discord)}</strong>
        {since.scannedAt ? `, plus recent history scanned ${ago(since.scannedAt)}` : ''}. Only when they chatted is kept,
        never what they said.
      </p>
      <div className="row">
        <button type="button" disabled={busy || scan?.running} onClick={onScan}>
          {scan?.running ? `Scanning… ${scan.done}/${scan.channels} channels` : 'Scan Discord history'}
        </button>
        {scan && !scan.running && (
          <span className="muted">
            {scan.error ? `Scan failed: ${scan.error}` : `Last scan read ${scan.messages.toLocaleString()} messages.`}
          </span>
        )}
      </div>
    </section>
  );
}

export default function TeamEditor({ guildId, onError }) {
  const [data, setData] = useState(null);
  const [guild, setGuild] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

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

  async function run(fn, okText) {
    setBusy(true);
    setNotice(null);
    try {
      setData(await fn());
      if (okText) setNotice({ type: 'ok', text: okText });
    } catch (err) {
      onError(err);
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    if (!data) return null;
    const all = data.groups.flatMap((g) => g.people);
    return { people: all.length, quiet: all.filter((p) => p.inactiveGame || p.inactiveDiscord).length };
  }, [data]);

  if (!data) return <Loading />;
  return (
    <div className="editor">
      <Notice notice={notice} />
      <Tracking
        data={data}
        busy={busy}
        onScan={() =>
          run(async () => {
            await api(`/guilds/${guildId}/team/scan`, { method: 'POST' });
            return api(`/guilds/${guildId}/team`);
          })
        }
      />
      <p className="muted">
        {totals.quiet} of {totals.people} haven’t played or chatted in {data.settings.inactiveDays}+ days.
      </p>
      {data.groups.map((g) => (
        <Group
          key={g.name}
          group={g}
          guild={guild}
          inactiveDays={data.settings.inactiveDays}
          busy={busy}
          onMatch={(robloxId, discordId) =>
            run(() => api(`/guilds/${guildId}/team/match`, { method: 'PUT', body: { robloxId, discordId } }), discordId ? 'Matched.' : 'Unmatched.')
          }
        />
      ))}
      <Settings
        data={data}
        guild={guild}
        busy={busy}
        onSave={(form) => run(() => api(`/guilds/${guildId}/team`, { method: 'PUT', body: form }), 'Saved.')}
      />
    </div>
  );
}
