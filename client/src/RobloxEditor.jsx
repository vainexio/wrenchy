import { useEffect, useState } from 'react';
import { api } from './api.js';
import {
  DiscordPreview,
  EnabledSwitch,
  Loading,
  Notice,
  PanelChannelCard,
  RoleChips,
  RoleOptions,
  SaveBar,
} from './PanelParts.jsx';
import { useGuildEditor } from './useGuildEditor.js';

function toForm(guild) {
  const rc = guild.roblox;
  return {
    enabled: rc.enabled,
    content: rc.content,
    buttonLabel: rc.buttonLabel,
    buttonEmoji: rc.buttonEmoji ?? '',
    gameUrl: rc.gameUrl ?? '',
    nicknameEnabled: rc.nicknameEnabled,
    nicknameFormat: rc.nicknameFormat,
    linkedRoleId: rc.linkedRoleId ?? '',
    bindings: rc.bindings.map((b) => ({ robloxRoleId: b.robloxRoleId, discordRoleIds: [...b.discordRoleIds] })),
  };
}

function ago(date) {
  if (!date) return 'never';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function GameStatus({ game }) {
  if (!game) return null;
  if (!game.keySet) return <span className="status bad">Bot has no GAME_API_KEY</span>;
  if (!game.lastSeenAt) return <span className="status idle">Game hasn’t connected yet</span>;
  return <span className="status ok">Game connected {ago(game.lastSeenAt)}</span>;
}

function RobloxRoleSelect({ value, roles, taken, onChange }) {
  const visible = roles.filter((r) => r.rank > 1); // (everyone holds Talyerista: not useful to bind)
  const groups = [
    ['Group roles', visible.filter((r) => !r.hidden)],
    ['Private roles', visible.filter((r) => r.hidden)],
  ];
  return (
    <select value={value || ''} onChange={(e) => onChange(Number(e.target.value))} aria-label="Roblox role">
      <option value="">Pick a Roblox role…</option>
      {groups.map(([label, list]) =>
        list.length ? (
          <optgroup key={label} label={label}>
            {list.map((r) => (
              <option key={r.id} value={r.id} disabled={taken.has(r.id) && r.id !== value}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  );
}

function LinkedStaff({ overview, busy, onSync, onUnlink }) {
  const { links } = overview;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Linked staff ({links.length})</h2>
        <button type="button" disabled={busy || !links.length} onClick={onSync}>
          Sync everyone
        </button>
      </div>
      {!links.length && <p className="muted">Nobody has linked yet.</p>}
      <ul className="links">
        {links.map((l) => (
          <li key={l.discordId}>
            <div className="link-who">
              {l.discordAvatar ? <img src={l.discordAvatar} alt="" /> : <span className="guild-icon">?</span>}
              <div className="grow">
                <div className="link-names">
                  <strong>{l.discordName}</strong>
                  <span className="muted">→</span>
                  <a href={`https://www.roblox.com/users/${l.robloxId}/profile`} target="_blank" rel="noreferrer">
                    @{l.username}
                  </a>
                  {!l.inServer && <span className="status idle">Not in this server</span>}
                </div>
                <div className="link-roles">
                  {l.roles.length ? (
                    l.roles.map((r) => (
                      <span key={r.id} className="role-pill">
                        {r.name}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No group roles</span>
                  )}
                </div>
              </div>
            </div>
            <div className="link-meta">
              <span className="muted" title={`Roles from the ${l.rolesFrom === 'game' ? 'game' : 'Roblox website'}`}>
                Synced {ago(l.syncedAt)}
              </span>
              <button type="button" className="danger-text" disabled={busy} onClick={() => onUnlink(l)}>
                Unlink
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function RobloxEditor({ guildId, onError }) {
  const editor = useGuildEditor({ guildId, kind: 'roblox', toForm, onError });
  const { guild, form, setForm, saved, dirty, busy, notice, panelUrl } = editor;
  const [overview, setOverview] = useState(null);
  const [listBusy, setListBusy] = useState(false);
  const [listNotice, setListNotice] = useState(null);

  useEffect(() => {
    api(`/guilds/${guildId}/roblox`).then(setOverview).catch(onError);
  }, [guildId]);

  if (!guild || !form) return <Loading />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setBinding = (i, changes) =>
    setForm({ ...form, bindings: form.bindings.map((b, j) => (j === i ? { ...b, ...changes } : b)) });
  const taken = new Set(form.bindings.map((b) => b.robloxRoleId));
  const incomplete = form.bindings.some((b) => !b.robloxRoleId || !b.discordRoleIds.length);

  const sample = overview?.links[0] ?? { username: 'juan123', displayName: 'Juan' };
  const nickPreview = form.nicknameFormat
    .replaceAll('{username}', sample.username)
    .replaceAll('{display}', sample.displayName || sample.username)
    .slice(0, 32);

  async function runList(action, okText) {
    setListBusy(true);
    setListNotice(null);
    try {
      const data = await action();
      setOverview(data);
      setListNotice({ type: 'ok', text: typeof okText === 'function' ? okText(data) : okText });
    } catch (err) {
      onError(err);
      setListNotice({ type: 'error', text: err.message });
    } finally {
      setListBusy(false);
    }
  }

  const syncAll = () =>
    runList(
      () => api(`/guilds/${guildId}/roblox/sync`, { method: 'POST' }),
      (d) => `Synced ${d.linked} linked member${d.linked === 1 ? '' : 's'} (${d.changed} changed).`,
    );
  const unlinkOne = (l) => {
    if (!window.confirm(`Unlink ${l.discordName} from @${l.username}? Their synced roles will be removed.`)) return;
    runList(() => api(`/guilds/${guildId}/roblox/links/${l.discordId}`, { method: 'DELETE' }), 'Unlinked.');
  };

  return (
    <>
      <form className="editor" onSubmit={(e) => editor.onSave(form, e)}>
        <section className="card">
          <div className="card-head">
            <h2>Roblox Link</h2>
            <EnabledSwitch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
          </div>
          <p className="muted">
            Staff press the button in Discord to get a code, then type <code>/link CODE</code> in Talyer. Only staff
            ranks can link (set in the game’s <code>Config.Admin.DiscordLink</code>).{' '}
            {panelUrl && (
              <>
                <a href={panelUrl} target="_blank" rel="noreferrer">
                  View panel in Discord
                </a>{' '}
              </>
            )}
            <GameStatus game={overview?.game} />
          </p>

          <div className="split">
            <div className="fields">
              <label className="field">
                <span>Message</span>
                <textarea rows={4} value={form.content} maxLength={2000} onChange={set('content')} required />
              </label>
              <div className="row">
                <label className="field grow">
                  <span>Button label</span>
                  <input value={form.buttonLabel} maxLength={80} onChange={set('buttonLabel')} required />
                </label>
                <label className="field small">
                  <span>Emoji</span>
                  <input value={form.buttonEmoji} maxLength={64} onChange={set('buttonEmoji')} placeholder="none" />
                </label>
              </div>
              <label className="field">
                <span>Game link (optional)</span>
                <input
                  type="url"
                  value={form.gameUrl}
                  onChange={set('gameUrl')}
                  placeholder="https://www.roblox.com/games/…"
                />
                <small className="muted">Adds an “Open Talyer” button next to the code.</small>
              </label>
            </div>
            <div className="preview">
              <span className="field-label">Preview</span>
              <DiscordPreview
                content={form.content}
                buttons={[{ label: form.buttonLabel, emoji: form.buttonEmoji }]}
                disabled={!form.enabled}
                reply={'Your link code is **K7F2QX**\nJoin Talyer on Roblox and type /link K7F2QX in chat.'}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Role sync</h2>
          <p className="muted">
            Matched by Roblox role ID, so reordering ranks in the group never breaks a binding. Roles update when staff
            join the game and every 30 minutes.
          </p>

          <div className="field">
            <span>Roblox role → Discord roles</span>
            <div className="bindings">
              {form.bindings.map((b, i) => (
                <div className="binding" key={i}>
                  {overview ? (
                    <RobloxRoleSelect
                      value={b.robloxRoleId}
                      roles={overview.groupRoles}
                      taken={taken}
                      onChange={(robloxRoleId) => setBinding(i, { robloxRoleId })}
                    />
                  ) : (
                    <select disabled>
                      <option>Loading roles…</option>
                    </select>
                  )}
                  <span className="binding-arrow" aria-hidden="true">
                    →
                  </span>
                  <RoleChips
                    roles={guild.roles}
                    value={b.discordRoleIds}
                    onChange={(discordRoleIds) => setBinding(i, { discordRoleIds })}
                  />
                  <button
                    type="button"
                    title="Remove binding"
                    onClick={() => setForm({ ...form, bindings: form.bindings.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setForm({ ...form, bindings: [...form.bindings, { robloxRoleId: 0, discordRoleIds: [] }] })}
              >
                + Add binding
              </button>
            </div>
            {incomplete && <small className="muted">Each binding needs a Roblox role and at least one Discord role.</small>}
          </div>

          <div className="row">
            <label className="field grow">
              <span>Role for everyone linked (optional)</span>
              <select value={form.linkedRoleId} onChange={set('linkedRoleId')}>
                <option value="">None</option>
                <RoleOptions roles={guild.roles} />
              </select>
            </label>
          </div>

          <div className="field">
            <label className="switch">
              <input
                type="checkbox"
                checked={form.nicknameEnabled}
                onChange={(e) => setForm({ ...form, nicknameEnabled: e.target.checked })}
              />
              <span>Set nickname from Roblox</span>
            </label>
            {form.nicknameEnabled && (
              <div className="row">
                <label className="field grow">
                  <span>Format</span>
                  <input value={form.nicknameFormat} maxLength={100} onChange={set('nicknameFormat')} required />
                  <small className="muted">
                    <code>{'{display}'}</code> display name, <code>{'{username}'}</code> username. Shows as{' '}
                    <strong>{nickPreview}</strong>
                  </small>
                </label>
              </div>
            )}
          </div>

          <SaveBar busy={busy} dirty={dirty} canSave={!incomplete} onDiscard={() => setForm(saved)} />
        </section>

        <PanelChannelCard editor={editor} onPost={() => editor.onPost(form)} />
        <Notice notice={notice} />
      </form>

      {overview ? (
        <LinkedStaff overview={overview} busy={listBusy} onSync={syncAll} onUnlink={unlinkOne} />
      ) : (
        <Loading />
      )}
      <Notice notice={listNotice} />
    </>
  );
}
