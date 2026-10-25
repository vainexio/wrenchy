import { useEffect, useState } from 'react';
import { api } from './api.js';
import { RoleChips, RoleOptions } from './PanelParts.jsx';
import { Badge, Button, Card, Empty, Field, Notice, PageHead, PageSkeleton, SaveBar, Toggle, ago, useToast } from './ui.jsx';
import { useGuildEditor } from './useGuildEditor.js';

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

function LinkedMembers({ overview, syncing, onSync }) {
  // (everyone Bloxlink verified is linked: the list shows the ones holding a bound group role)
  const all = overview.links;
  const links = all.filter((l) => l.roles.length);
  const quiet = all.length - links.length;
  return (
    <Card
      title="Linked members"
      description={
        <>
          Verified members holding a bound group role, and the roles their Discord roles follow. In Discord: <code>/update</code>{' '}
          for one member, <code>/updateall</code> for everyone.
        </>
      }
      bodyClass=""
      aside={
        <Button icon="refresh" loading={syncing} onClick={onSync}>
          Update everyone
        </Button>
      }
      footer={quiet ? <span className="subtle">{quiet} more linked member{quiet === 1 ? '' : 's'} with no bound group role.</span> : undefined}
    >
      {!links.length ? (
        <Empty icon="link" title="Nobody with a bound group role is linked yet">
          Pick the Verified role and the bindings above, save, then press Update everyone.
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
                    {!l.inServer && <Badge tone="warn">Not in this server</Badge>}
                  </div>
                  <div className="who-sub">
                    {l.roles.map((r) => (
                      <span key={r.id} className="pill">
                        {r.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <span className="subtle">Updated {ago(l.syncedAt) ?? 'never'}</span>
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

  useEffect(() => {
    api(`/guilds/${guildId}/roblox`).then(setOverview).catch(onError);
  }, [guildId]);

  if (!guild || !form) return <PageSkeleton />;

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
        <Card
          title="Bloxlink verification"
          description={
            <>
              Members with this role are linked to the Roblox username in their nickname, whatever the format: “vai (@VA1_N)”,
              “VA1_N” and “vai | VA1_N” all link to VA1_N. They’re updated when they get the role or change their nickname, and
              with <code>/update</code> and <code>/updateall</code>. Lose the role and the bound roles come off.
            </>
          }
        >
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
            <p className="subtle">
              {overview.verified.count} verified member{overview.verified.count === 1 ? '' : 's'}
              {overview.verified.unreadable.length
                ? `, ${overview.verified.unreadable.length} not linked:`
                : '.'}
            </p>
          )}
          {showCounts && overview.verified.unreadable.length > 0 && (
            <Notice tone="warn">
              {overview.verified.unreadable
                .slice(0, 12)
                .map((m) => `${m.discordName}${m.nickname ? '' : ' (no nickname)'}`)
                .join(', ')}
              {overview.verified.unreadable.length > 12 ? ` and ${overview.verified.unreadable.length - 12} more` : ''}. Their
              nickname needs their Roblox username in it (Bloxlink’s /update sets it), then press Update everyone.
              <code>/update</code> on one of them says what’s wrong.
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

        <Card title="Role for everyone linked" description="Given to every verified, linked member, whatever their group roles.">
          <Field label="Role (optional)">
            <select value={form.linkedRoleId} onChange={set('linkedRoleId')}>
              <option value="">None</option>
              <RoleOptions roles={guild.roles} />
            </select>
          </Field>
        </Card>

        {overview ? <LinkedMembers overview={overview} syncing={syncing} onSync={syncAll} /> : <div className="skeleton" style={{ height: 160 }} />}
      </div>

      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={() => editor.onSave(form)} onDiscard={editor.discard} />
    </>
  );
}
