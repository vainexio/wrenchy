import { useEffect, useState } from 'react';
import { rankByName } from '../../src/shared/search.js';
import { api } from './api.js';
import { similarFirst } from './teamModel.js';
import { Badge, Button, Popover, SearchList, useDebounced } from './ui.jsx';

// Finding people: a Discord member (the whole server, searched on the server) and a Roblox account from the team's
// unmatched ones. Used by Match Discord / Match Roblox and Add member.

export function MemberRow({ m }) {
  const sub = [m.username && `@${m.username}`, m.nickname && m.nickname !== m.displayName && m.nickname].filter(Boolean).join(' · ');
  return (
    <div className="pick-row">
      {m.avatar ? <img className="avatar-xs" src={m.avatar} alt="" /> : <span className="avatar-xs">{(m.displayName ?? '?')[0]}</span>}
      <span className="grow">
        {m.displayName}
        {sub && <small>{sub}</small>}
      </span>
      {m.linkedTo ? (
        <Badge tone="warn" title="Bloxlink linked them to a Roblox account">Linked to @{m.linkedTo}</Badge>
      ) : m.matched ? (
        <Badge tone="warn" title="Already matched to a Roblox account by hand">Matched</Badge>
      ) : (
        m.roles?.[0] && <span className="pill">{m.roles[0]}</span>
      )}
    </div>
  );
}

/**
 * Search the server's members. With nothing typed it shows `suggested` (under `suggestedLabel`), then members named
 * like `seed`. onPick(member).
 */
export function MemberSearch({ guildId, title, seed, suggested = [], suggestedLabel, onPick }) {
  const [query, setQuery] = useState('');
  const typed = useDebounced(query.trim(), 200);
  const ask = typed || seed;
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
    const ids = new Set(suggested.map((m) => m.id));
    items = [
      ...suggested.map((m) => toItem(m, suggestedLabel)),
      ...(found.for === ask && seed ? found.results.filter((m) => !ids.has(m.id)).map((m) => toItem(m, `Named like “${ask}”`)) : []),
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
      {title && <div className="picker-head">{title}</div>}
      <SearchList
        query={query}
        onQuery={setQuery}
        placeholder="Search members…"
        items={items}
        loading={loading}
        onPick={(it) => onPick(it.member)}
        empty={query.trim() ? `Nobody matches “${query.trim()}”. Try their username, nickname or ID.` : 'Type to search the server.'}
        footer={footer}
      />
    </div>
  );
}

/** Find the Discord member a Roblox account belongs to. `spare`: team people with no Roblox account. */
export function DiscordPicker({ guildId, p, spare, onPick }) {
  const suggested = similarFirst(spare, p.username, (s) => [s.discordName]).map((s) => ({
    id: s.discordId, displayName: s.discordName, avatar: s.discordAvatar, roles: s.discordRoles,
  }));
  return (
    <MemberSearch
      guildId={guildId}
      title={<>Who is <strong>@{p.username}</strong> on Discord?</>}
      seed={nameSeedOf(p)}
      suggested={suggested}
      suggestedLabel="In a team group, no Roblox account"
      onPick={onPick}
    />
  );
}

const nameSeedOf = (p) => (p.username ?? '').match(/[A-Za-z]{3,}/)?.[0] ?? (p.displayName ?? '').match(/[A-Za-z]{3,}/)?.[0] ?? '';

/** Find the Roblox account a Discord-only member is: the group's Roblox accounts nobody's matched to yet. */
export function RobloxPicker({ p, spareRoblox, onPick }) {
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

export function MatchButton({ label, variant, title, busy, children }) {
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

/** The match / unmatch control for a person's missing or guessed account, or null when there's nothing to do. */
export function MatchActions({ p, guildId, spare, spareRoblox, busy, onMatch, onUnmatch }) {
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
