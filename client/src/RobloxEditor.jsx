import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useBot } from './appContext.js';
import { DiscordPreview, PanelChannelCard, RoleChips, RoleOptions } from './PanelParts.jsx';
import { Badge, Button, Card, Empty, Field, Notice, PageHead, PageSkeleton, SaveBar, Toggle, ago, useConfirm, useToast } from './ui.jsx';
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
    verifiedRoleId: rc.verifiedRoleId ?? '',
    bindings: rc.bindings.map((b) => ({ robloxRoleId: b.robloxRoleId, discordRoleIds: [...b.discordRoleIds] })),
  };
}

function GameStatus({ game }) {
  if (!game) return null;
  if (!game.keySet) return <Badge tone="bad" dot>Bot has no GAME_API_KEY</Badge>;
  if (!game.lastSeenAt) return <Badge dot>Game hasn’t connected yet</Badge>;
  return (
    <Badge tone="ok" dot title={new Date(game.lastSeenAt).toLocaleString()}>
      Game connected {ago(game.lastSeenAt)}
    </Badge>
  );
}

function RobloxRoleSelect({ value, roles, taken, onChange }) {
  const visible = roles.filter((r) => r.rank > 1); // (everyone holds the member role: not useful to bind)
  const groups = [
    ['Group roles', visible.filter((r) => !r.hidden)],
    ['Private roles', visible.filter((r) => r.hidden)],
  ];
  return (
    <select value={value || ''} onChange={(e) => onChange(Number(e.target.value))} aria-label="Roblox role" className={!value ? 'invalid' : ''}>
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

/** Bindings for the group roles that have a Discord role of the same name and no binding yet. */
function sameNameBindings(groupRoles, discordRoles, bindings) {
  const bound = new Set(bindings.map((b) => b.robloxRoleId));
  const key = (name) => name.trim().toLowerCase();
  const byName = new Map(discordRoles.filter((r) => !r.problem).map((r) => [key(r.name), r.id]));
  return groupRoles
    .filter((g) => g.rank > 1 && !bound.has(g.id) && byName.has(key(g.name)))
    .map((g) => ({ robloxRoleId: g.id, discordRoleIds: [byName.get(key(g.name))] }));
}

function LinkedStaff({ overview, syncing, unlinking, onSync, onUnlink }) {
  // (everyone Bloxlink verified is linked: the list shows the ones holding a group role, and anyone linked in game)
  const all = overview.links;
  const links = all.filter((l) => l.roles.length || l.source === 'game');
  const quiet = all.length - links.length;
  return (
    <Card
      title="Linked members"
      description={
        <>
          Everyone linked to a Roblox account, with the group roles their Discord roles follow. In Discord: <code>/update</code>{' '}
          for one member, <code>/updateall</code> for everyone.
        </>
      }
      bodyClass=""
      aside={
        <Button icon="refresh" loading={syncing} onClick={onSync}>
          Update everyone
        </Button>
      }
      footer={quiet ? <span className="subtle">{quiet} more linked member{quiet === 1 ? '' : 's'} with no group role.</span> : undefined}
    >
      {!links.length ? (
        <Empty icon="link" title="Nobody with a group role is linked yet">
          Pick the Verified role above and press Update everyone, or staff press the link panel’s button.
        </Empty>
      ) : (
        <ul className="list">
          {links.map((l) => (
            <li key={l.discordId}>
              <div className="who">
                {l.discordAvatar ? <img className="avatar-sm" src={l.discordAvatar} alt="" /> : <span className="avatar-sm">?</span>}
                <div className="grow">
                  <div className="who-names">
                    <strong>{l.discordName}</strong>
                    <a href={`https://www.roblox.com/users/${l.robloxId}/profile`} target="_blank" rel="noreferrer">
                      @{l.username}
                    </a>
                    <Badge title={l.source === 'game' ? 'Linked with /link in the game' : 'From their Verified role and Bloxlink nickname'}>
                      {l.source === 'game' ? 'Game' : 'Bloxlink'}
                    </Badge>
                    {!l.inServer && <Badge tone="warn">Not in this server</Badge>}
                  </div>
                  <div className="who-sub">
                    {l.roles.length ? l.roles.map((r) => <span key={r.id} className="pill">{r.name}</span>) : <span className="subtle">No group roles</span>}
                  </div>
                </div>
              </div>
              <span className="subtle" title={`Roles from the ${l.rolesFrom === 'game' ? 'game' : 'Roblox website'}`}>
                Synced {ago(l.syncedAt) ?? 'never'}
              </span>
              {l.source === 'game' ? (
                <Button size="sm" variant="ghost-danger" icon="x" loading={unlinking === l.discordId} onClick={() => onUnlink(l)}>
                  Unlink
                </Button>
              ) : (
                <span className="subtle" title="A Bloxlink link follows the Verified role and the nickname: take the role off to unlink">
                  Follows Verified
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function RobloxEditor({ guildId, onError }) {
  const bot = useBot();
  const toast = useToast();
  const confirm = useConfirm();
  const editor = useGuildEditor({ guildId, kind: 'roblox', toForm, onError });
  const { guild, form, setForm, dirty, busy, nudge } = editor;
  const [overview, setOverview] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [unlinking, setUnlinking] = useState(null);

  useEffect(() => {
    api(`/guilds/${guildId}/roblox`).then(setOverview).catch(onError);
  }, [guildId]);

  if (!guild || !form) return <PageSkeleton />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setBinding = (i, changes) =>
    setForm({ ...form, bindings: form.bindings.map((b, j) => (j === i ? { ...b, ...changes } : b)) });
  const taken = new Set(form.bindings.map((b) => b.robloxRoleId));
  const incomplete = form.bindings.some((b) => !b.robloxRoleId || !b.discordRoleIds.length);
  const badNick = form.nicknameEnabled && !form.nicknameFormat.includes('{username}') && !form.nicknameFormat.includes('{display}');
  const blocked = incomplete
    ? 'Each binding needs a Roblox role and a Discord role'
    : badNick
      ? 'The nickname needs {username} or {display}'
      : !form.content.trim()
        ? 'The message can’t be empty'
        : null;

  const savedVerified = guild.roblox.verifiedRoleId ?? '';
  const sample = overview?.links[0] ?? { username: 'juan123', displayName: 'Juan' };
  const nickPreview = form.nicknameFormat
    .replaceAll('{username}', sample.username)
    .replaceAll('{display}', sample.displayName || sample.username)
    .slice(0, 32);

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

  async function unlinkOne(l) {
    const ok = await confirm({
      title: `Unlink ${l.discordName}?`,
      text: `They’re unlinked from @${l.username} and lose the Discord roles that came from their rank. They can link again any time.`,
      confirmLabel: 'Unlink',
      danger: true,
    });
    if (!ok) return;
    setUnlinking(l.discordId);
    try {
      setOverview(await api(`/guilds/${guildId}/roblox/links/${l.discordId}`, { method: 'DELETE' }));
      toast({ title: `Unlinked ${l.discordName}` });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Couldn’t unlink', text: err.message });
    } finally {
      setUnlinking(null);
    }
  }

  return (
    <>
      <PageHead
        title="Roblox Link"
        description="Staff link their Discord to their Roblox account, and their Discord roles follow their rank in the group."
      >
        <GameStatus game={overview?.game} />
        <Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label={form.enabled ? 'On' : 'Off'} />
      </PageHead>

      <div className="stack">
        <Card
          title="Bloxlink verification"
          description={
            <>
              Members with this role are linked from their Bloxlink nickname, <strong>Display (@username)</strong>: “vai (@VA1_N)”
              links to VA1_N. They’re updated when they get the role or change their nickname, every 30 minutes, and with{' '}
              <code>/update</code>. Lose the role and the bound roles come off.
            </>
          }
        >
          <Field label="Verified role">
            <select value={form.verifiedRoleId} onChange={set('verifiedRoleId')}>
              <option value="">Off (only links made in the game)</option>
              {guild.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  @{r.name}
                </option>
              ))}
            </select>
          </Field>
          {overview?.verified && savedVerified && form.verifiedRoleId === savedVerified && (
            <p className="subtle">
              {overview.verified.count} verified member{overview.verified.count === 1 ? '' : 's'}
              {overview.verified.unreadable.length
                ? `, ${overview.verified.unreadable.length} with a nickname that doesn’t name an account:`
                : '.'}
            </p>
          )}
          {overview?.verified?.unreadable.length > 0 && savedVerified && form.verifiedRoleId === savedVerified && (
            <Notice tone="warn">
              {overview.verified.unreadable
                .slice(0, 12)
                .map((m) => `${m.discordName}${m.nickname ? '' : ' (no nickname)'}`)
                .join(', ')}
              {overview.verified.unreadable.length > 12 ? ` and ${overview.verified.unreadable.length - 12} more` : ''}. Their
              nickname needs to end in (@username): have them run Bloxlink’s /update.
            </Notice>
          )}
        </Card>

        <Card
          title="Role sync"
          description="Each Roblox group role gives its Discord roles; someone holding several group roles gets all of their bindings. Matched by role ID, so reordering ranks never breaks a binding."
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

        <Card title="Nickname and linked role" description="What every linked member gets, whatever their rank.">
          <div className="fields-row">
            <Field label="Role for everyone linked (optional)">
              <select value={form.linkedRoleId} onChange={set('linkedRoleId')}>
                <option value="">None</option>
                <RoleOptions roles={guild.roles} />
              </select>
            </Field>
            <div className="field">
              <Toggle
                checked={form.nicknameEnabled}
                onChange={(nicknameEnabled) => setForm({ ...form, nicknameEnabled })}
                label="Set nickname from Roblox"
                description="Their Discord nickname follows their Roblox name."
              />
            </div>
          </div>
          {form.nicknameEnabled && (
            <Field
              label="Nickname format"
              error={badNick ? 'Put {username} or {display} in it.' : undefined}
              hint={
                <>
                  <code>{'{display}'}</code> display name, <code>{'{username}'}</code> username. Shows as <strong>{nickPreview}</strong>
                </>
              }
            >
              <input value={form.nicknameFormat} maxLength={100} onChange={set('nicknameFormat')} className={badNick ? 'invalid' : ''} />
            </Field>
          )}
        </Card>

        {overview ? <LinkedStaff overview={overview} syncing={syncing} unlinking={unlinking} onSync={syncAll} onUnlink={unlinkOne} /> : <div className="skeleton" style={{ height: 160 }} />}

        <Card title="Link panel" description={<>Staff press the button to get a code, then type <code>/link CODE</code> in the game. Only staff ranks can link (the game decides).</>}>
          <div className="split">
            <div>
              <Field label="Message" max={2000} value={form.content}>
                <textarea rows={4} value={form.content} maxLength={2000} onChange={set('content')} className={!form.content.trim() ? 'invalid' : ''} />
              </Field>
              <div className="row">
                <Field label="Button label" className="grow" max={80} value={form.buttonLabel}>
                  <input value={form.buttonLabel} maxLength={80} onChange={set('buttonLabel')} />
                </Field>
                <Field label="Emoji" className="small">
                  <input value={form.buttonEmoji} maxLength={64} onChange={set('buttonEmoji')} placeholder="none" />
                </Field>
              </div>
              <Field label="Game link (optional)" hint="Adds an “Open game” button next to the code.">
                <input type="url" value={form.gameUrl} onChange={set('gameUrl')} placeholder="https://www.roblox.com/games/…" />
              </Field>
            </div>
            <DiscordPreview
              bot={bot}
              content={form.content}
              buttons={[{ label: form.buttonLabel, emoji: form.buttonEmoji }]}
              disabled={!form.enabled}
              reply={'Your link code is **K7F2QX**\nJoin the game on Roblox and type /link K7F2QX in chat.'}
            />
          </div>
        </Card>

        <PanelChannelCard editor={editor} onPost={() => editor.onPost(form)} />
      </div>

      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={() => editor.onSave(form)} onDiscard={editor.discard} />
    </>
  );
}
