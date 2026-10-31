import { useEffect, useState } from 'react';
import { api } from './api.js';
import { whyNotGivable } from './teamModel.js';
import { MemberSearch } from './teamPickers.jsx';
import { Badge, Button, Card, Field, Notice, Segmented, Toggle, useToast } from './ui.jsx';

// Add members: one or many people (search, or paste their Discord IDs / mentions), their Roblox accounts optional, a
// group and role, and the onboarding guide. Whoever is verified and in the community already is ranked right away;
// the others are ranked when they finish the guide's "Join the community" step. The results say who's where.

function Step({ n, title, done, children }) {
  return (
    <section className={`step${done ? ' done' : ''}`}>
      <div className="step-head">
        <span className="step-n">{n}</span>
        <h3>{title}</h3>
      </div>
      <div className="step-body">{children}</div>
    </section>
  );
}

const DELIVERY = { dm: 'Sent by DM', channel: 'Posted in the fallback channel', none: 'Not sent' };

function Results({ results, onMore, onOnboarding }) {
  const ranked = results.filter((r) => r.ranked).length;
  return (
    <Card
      title={`Added ${results.filter((r) => r.verified !== undefined).length} of ${results.length}`}
      description={`${ranked} ranked, ${results.length - ranked} not ranked yet. The ones not ranked are ranked when they finish the guide’s community step.`}
      bodyClass=""
      footer={
        <>
          <Button variant="ghost" onClick={onOnboarding}>See everyone’s progress</Button>
          <Button variant="primary" icon="userPlus" onClick={onMore}>Add more</Button>
        </>
      }
    >
      <div className="results">
        <div className="results-head">
          <span>Person</span><span>Verified</span><span>Roblox</span><span>Ranked</span><span>Guide</span>
        </div>
        {results.map((r) => (
          <div key={r.discordId} className="results-row">
            <span className="grow">
              <b>{r.name}</b>
              {r.problem && <small className="warn-text">{r.problem}</small>}
            </span>
            <span>{r.verified === undefined ? '—' : r.verified ? <Badge tone="ok">Yes</Badge> : <Badge tone="warn">Not yet</Badge>}</span>
            <span className="subtle">{r.username ? `@${r.username}` : r.inGroup === undefined ? '—' : 'Not known yet'}</span>
            <span>{r.ranked === undefined ? '—' : r.ranked ? <Badge tone="ok">{r.rankedNow ? 'Ranked now' : 'Already'}</Badge> : <Badge tone="warn">Not yet</Badge>}</span>
            <span className="subtle">{r.delivery ? DELIVERY[r.delivery] : '—'}{r.step && r.step !== 'Done' && r.delivery !== 'none' ? ` · at “${r.step}”` : ''}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function TeamAdd({ guildId, guild, data, admin, people, onTeam, onError, onOnboarding }) {
  const toast = useToast();
  const [picked, setPicked] = useState([]);
  const [paste, setPaste] = useState(null); // (null = closed)
  const [pasting, setPasting] = useState(false);
  const [groupName, setGroupName] = useState(data.settings.groups[0]?.name ?? '');
  const [roleId, setRoleId] = useState('');
  const [sendGuide, setSendGuide] = useState(true);
  const [guide, setGuide] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    api(`/guilds/${guildId}/team/onboarding`).then((o) => setGuide(o.guide)).catch(onError);
  }, [guildId]);

  const group = data.settings.groups.find((g) => g.name === groupName);
  const groupRoles = (admin?.roles ?? []).filter((r) => group?.robloxRoleIds.includes(r.id)).sort((a, b) => a.rank - b.rank);
  const needsRoblox = Boolean(group?.robloxRoleIds.length);
  useEffect(() => setRoleId(groupRoles[0]?.id ?? ''), [groupName, admin]);
  const role = groupRoles.find((r) => r.id === Number(roleId));
  const discordRoles = (group?.discordRoleIds ?? []).map((id) => guild?.roles.find((r) => r.id === id)?.name ?? 'deleted role');

  const add = (m) => setPicked((list) => (list.some((p) => p.id === m.id) ? list : [...list, { ...m, roblox: '' }]));
  const setRoblox = (id, roblox) => setPicked((list) => list.map((p) => (p.id === id ? { ...p, roblox } : p)));

  async function addPasted() {
    const ids = [...new Set((paste.match(/\d{17,20}/g) ?? []))].filter((id) => !picked.some((p) => p.id === id));
    if (!ids.length) {
      toast({ tone: 'error', title: 'No Discord IDs found', text: 'Paste their IDs or @mentions, like <@123456789012345678>.' });
      return;
    }
    setPasting(true);
    const missing = [];
    for (const id of ids.slice(0, 50)) {
      const found = await api(`/guilds/${guildId}/members?q=${id}&limit=1`).catch(() => null);
      const m = found?.results.find((r) => r.id === id);
      if (m) add(m);
      else missing.push(id);
    }
    setPasting(false);
    setPaste(null);
    toast(missing.length
      ? { tone: 'error', title: `Added ${ids.length - missing.length}, ${missing.length} not found`, text: `Not in the server: ${missing.join(', ')}` }
      : { title: `Added ${ids.length} ${ids.length === 1 ? 'person' : 'people'} to the list` });
  }

  const blocked = !picked.length
    ? 'Pick who to add'
    : needsRoblox && !role
      ? 'Pick a Roblox role'
      : null;

  async function submit() {
    setBusy(true);
    try {
      const { results: rows, team } = await api(`/guilds/${guildId}/team/onboard`, {
        method: 'POST',
        body: {
          group: group.name, robloxRoleId: role?.id, sendGuide,
          people: picked.map((p) => ({ discordId: p.id, name: p.displayName, roblox: p.roblox.trim() })),
        },
      });
      onTeam(team);
      setResults(rows);
      const ranked = rows.filter((r) => r.ranked).length;
      toast({ title: `Added ${rows.length} to ${group.name}`, text: `${ranked} ranked${sendGuide ? ', the guide is on its way to the rest' : ''}.` });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Couldn’t add them', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (results) {
    return (
      <Results
        results={results}
        onOnboarding={onOnboarding}
        onMore={() => {
          setResults(null);
          setPicked([]);
        }}
      />
    );
  }

  return (
    <Card
      title="Add members"
      description="Add one person or many. Anyone verified and in the community is ranked right away; the guide walks the rest through it."
      footer={
        <>
          <span className="grow subtle" style={{ alignSelf: 'center' }}>{blocked ?? `Adds ${picked.length} ${picked.length === 1 ? 'person' : 'people'} to ${group.name}`}</span>
          <Button variant="primary" icon="userPlus" loading={busy} disabled={Boolean(blocked)} onClick={submit}>
            Add {picked.length || ''} {picked.length === 1 ? 'person' : 'people'}
          </Button>
        </>
      }
    >
      <div className="steps">
        <Step n={1} title="Who" done={picked.length > 0}>
          <div className="inline-picker">
            <MemberSearch guildId={guildId} onPick={add} />
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            {paste === null ? (
              <button type="button" className="link-btn" onClick={() => setPaste('')}>Paste a list of Discord IDs or mentions</button>
            ) : (
              <div className="paste grow">
                <textarea rows={3} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'123456789012345678\n<@234567890123456789>'} aria-label="Discord IDs or mentions" />
                <div className="row">
                  <Button size="sm" loading={pasting} onClick={addPasted}>Add them</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPaste(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
          {picked.length > 0 && (
            <div className="picked-list">
              <div className="picked-list-head">
                <b>{picked.length}</b> {picked.length === 1 ? 'person' : 'people'}
                <span className="subtle">Roblox username optional: it’s found from Bloxlink when they verify.</span>
                <button type="button" className="link-btn" onClick={() => setPicked([])}>Clear</button>
              </div>
              {picked.map((p) => {
                const already = people.find((x) => x.discordId === p.id);
                return (
                  <div key={p.id} className="picked-row">
                    {p.avatar ? <img className="avatar-xs" src={p.avatar} alt="" /> : <span className="avatar-xs">{p.displayName[0]}</span>}
                    <span className="grow">
                      <b>{p.displayName}</b>
                      <small>{[p.username && `@${p.username}`, already && `already in ${already.groups.join(', ')}`].filter(Boolean).join(' · ')}</small>
                    </span>
                    {p.linkedTo ? (
                      <Badge tone="ok" title="Bloxlink links them already">Roblox @{p.linkedTo}</Badge>
                    ) : (
                      <input value={p.roblox} onChange={(e) => setRoblox(p.id, e.target.value)} placeholder="Roblox username" aria-label={`${p.displayName}'s Roblox username`} />
                    )}
                    <Button size="sm" variant="ghost" icon="x" title="Take off the list" onClick={() => setPicked((list) => list.filter((x) => x.id !== p.id))} />
                  </div>
                );
              })}
            </div>
          )}
        </Step>

        <Step n={2} title="Group and role" done={Boolean(group && (!needsRoblox || role))}>
          {data.settings.groups.length > 1 && (
            <Segmented label="Team group" value={groupName} onChange={setGroupName} options={data.settings.groups.map((g) => ({ value: g.name, label: g.name }))} />
          )}
          {needsRoblox && (
            <Field label="Roblox role">
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {!groupRoles.length && <option value="">Loading roles…</option>}
                {groupRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.assignable ? '' : ` (${whyNotGivable(admin, r)}: they won’t be ranked)`}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {needsRoblox && admin && !admin.bot.ok && (
            <Notice tone="warn">The Roblox bot account isn’t working, so nobody is ranked: they’re added and get the guide, and you can rank them from Onboarding later.</Notice>
          )}
          {discordRoles.length > 0 && <p className="hint">On Discord they get {discordRoles.map((n) => `@${n}`).join(', ')} once they’re ranked.</p>}
        </Step>

        <Step n={3} title="Onboarding guide" done={sendGuide}>
          <Toggle checked={sendGuide} onChange={setSendGuide} label="Send them the onboarding guide" description="By DM, one step at a time, each checked when they press Done. Steps they’ve already done are skipped." />
          {sendGuide && guide && (
            <ol className="guide-outline">
              {guide.steps.map((s) => <li key={s.id}>{s.title}</li>)}
              <li className="subtle">
                <button type="button" className="link-btn" onClick={onOnboarding}>Edit the guide</button>
              </li>
            </ol>
          )}
        </Step>
      </div>
    </Card>
  );
}
