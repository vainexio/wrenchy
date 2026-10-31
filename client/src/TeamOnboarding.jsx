import { useEffect, useState } from 'react';
import { matchScore } from '../../src/shared/search.js';
import { api } from './api.js';
import { useReportDirty } from './appContext.js';
import { renderMarkdown } from './PanelParts.jsx';
import {
  Badge, Button, Card, Empty, Field, FilterMenu, FilterSummary, Icon, SaveBar, SearchInput, Segmented, Toggle, ago,
  useConfirm, useToast,
} from './ui.jsx';
import { useUrlState } from './urlState.js';

// Onboarding: everyone who's been sent the guide and how far they are (who isn't ranked yet, who's stuck and why), with
// Resend / Rank now / Cancel; and the guide itself, step by step.

const KIND = {
  verify: 'Verify with Bloxlink (checks the Verified role)',
  group: 'Join the community (checks, then ranks them)',
  channels: 'Read channels',
  info: 'Anything else (just a Done button)',
};
const STATES = { active: { label: 'In progress', tone: 'accent' }, done: { label: 'Done', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: '' } };
const DELIVERY = { dm: 'by DM', channel: 'in the fallback channel', none: 'not delivered' };
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

// ------------------------------------------------------------------ progress
function Progress({ guildId, people, onOverview, onTeam, onError }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [u, setU] = useUrlState({ ofind: '', ostate: '', orank: '' });
  const f = { find: u.ofind, state: u.ostate, rank: u.orank };
  const setF = (c) => setU(Object.fromEntries(Object.entries(c).map(([k, v]) => [`o${k}`, v])));
  const [busy, setBusy] = useState(null);
  const shown = people.filter(
    (p) =>
      (!f.state || p.status === f.state) &&
      (!f.rank || (f.rank === 'yes') === p.ranked) &&
      (!f.find.trim() || matchScore([p.discordName, p.username, p.discordId, p.group], f.find) !== null),
  );
  const chips = [
    f.find.trim() && { key: 'find', label: `“${f.find.trim()}”`, onRemove: () => setF({ find: '' }) },
    f.state && { key: 'state', label: STATES[f.state].label, onRemove: () => setF({ state: '' }) },
    f.rank && { key: 'rank', label: f.rank === 'yes' ? 'Ranked' : 'Not ranked', onRemove: () => setF({ rank: '' }) },
  ].filter(Boolean);

  async function act(p, action) {
    if (action === 'cancel' && !(await confirm({ title: `Cancel ${p.discordName}'s guide?`, text: 'Its buttons stop working. They stay on the team as they are.', confirmLabel: 'Cancel guide', danger: true }))) return;
    setBusy(`${p.id}${action}`);
    try {
      const { text, team, ...next } = await api(`/guilds/${guildId}/team/onboarding/${p.id}/${action}`, { method: 'POST' });
      onOverview(next);
      if (team) onTeam(team);
      toast({ title: text });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'That didn’t work', text: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card bodyClass="">
      <div className="list-toolbar">
        <SearchInput value={f.find} onChange={(v) => setF({ find: v })} placeholder="Search a name…" className="grow" />
        <div className="toolbar-group">
          <FilterMenu label="Status" value={f.state} onChange={(v) => setF({ state: v })}
            options={Object.entries(STATES).map(([value, s]) => ({ value, label: s.label, count: people.filter((p) => p.status === value).length }))} />
          <FilterMenu label="Ranked" value={f.rank} onChange={(v) => setF({ rank: v })}
            options={[{ value: 'yes', label: 'Ranked', count: people.filter((p) => p.ranked).length }, { value: 'no', label: 'Not ranked', count: people.filter((p) => !p.ranked).length }]} />
        </div>
      </div>
      <FilterSummary shown={shown.length} total={people.length} noun="people" chips={chips} onClear={() => setF({ find: '', state: '', rank: '' })} />
      {!people.length ? (
        <Empty icon="userPlus" title="Nobody’s been sent the guide yet">Add members and they show up here with their progress.</Empty>
      ) : !shown.length ? (
        <Empty icon="search" title="Nobody matches" />
      ) : (
        <ul className="list">
          {shown.map((p) => {
            const at = p.steps.findIndex((s) => !s.doneAt);
            return (
              <li key={p.id} className="onboard-row">
                <div className="who">
                  {p.avatar ? <img className="avatar-sm" src={p.avatar} alt="" /> : <span className="avatar-sm">{p.discordName?.[0]}</span>}
                  <div className="grow">
                    <div className="who-names">
                      <strong>{p.discordName}</strong>
                      {p.username && <span className="subtle">@{p.username}</span>}
                      <Badge tone={STATES[p.status].tone}>{STATES[p.status].label}</Badge>
                      <Badge tone={p.ranked ? 'ok' : 'warn'}>{p.ranked ? 'Ranked' : 'Not ranked'}</Badge>
                    </div>
                    <div className="step-pills">
                      {p.steps.map((s, i) => (
                        <span key={s.id} className={`step-pill${s.doneAt ? ' done' : i === at && p.status === 'active' ? ' now' : ''}`}>
                          {s.doneAt ? '✓' : i === at && p.status === 'active' ? '→' : '○'} {s.title}
                        </span>
                      ))}
                      {!p.steps.length && <span className="subtle">Nothing to do: they’d done every step already</span>}
                    </div>
                    <div className="who-sub">
                      {p.group} · added {ago(p.createdAt)} by {p.by?.name} · guide {DELIVERY[p.delivery]}
                      {p.completedAt ? ` · finished ${ago(p.completedAt)}` : ''}
                    </div>
                    {p.note && p.status === 'active' && <div className="warn-text onboard-note">{p.note}</div>}
                  </div>
                </div>
                <div className="row-actions onboard-actions">
                  {!p.ranked && (
                    <Button size="sm" variant="primary" loading={busy === `${p.id}rank`} disabled={Boolean(busy)} onClick={() => act(p, 'rank')} title="Rank them now, if they've verified and joined the community">
                      Rank now
                    </Button>
                  )}
                  {p.status === 'active' && (
                    <>
                      <Button size="sm" icon="send" loading={busy === `${p.id}resend`} disabled={Boolean(busy)} onClick={() => act(p, 'resend')}>Resend</Button>
                      <Button size="sm" variant="ghost-danger" loading={busy === `${p.id}cancel`} disabled={Boolean(busy)} onClick={() => act(p, 'cancel')}>Cancel</Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ the guide
function ChannelPicker({ channels, value, onChange }) {
  const left = channels.filter((c) => !value.includes(c.id));
  return (
    <div className="chips">
      {value.map((id) => (
        <span key={id} className="chip">
          #{channels.find((c) => c.id === id)?.name ?? 'deleted-channel'}
          <button type="button" aria-label="Remove" title="Remove" onClick={() => onChange(value.filter((x) => x !== id))}>✕</button>
        </span>
      ))}
      {left.length > 0 && (
        <select className="chip-add" value="" aria-label="Add a channel" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">+ Add channel</option>
          {left.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ''}</option>)}
        </select>
      )}
    </div>
  );
}

function StepEditor({ step, i, count, channels, kindsTaken, onChange, onMove, onRemove }) {
  const set = (changes) => onChange({ ...step, ...changes });
  return (
    <div className="guide-step">
      <div className="guide-step-head">
        <span className="step-n">{i + 1}</span>
        <select value={step.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="What this step is">
          {Object.entries(KIND).map(([k, label]) => (
            <option key={k} value={k} disabled={k !== step.kind && kindsTaken.has(k) && (k === 'verify' || k === 'group')}>{label}</option>
          ))}
        </select>
        <span className="grow" />
        <Button size="sm" variant="ghost" icon="up" title="Move up" disabled={i === 0} onClick={() => onMove(-1)} />
        <Button size="sm" variant="ghost" icon="down" title="Move down" disabled={i === count - 1} onClick={() => onMove(1)} />
        <Button size="sm" variant="ghost-danger" icon="trash" title="Remove step" onClick={onRemove} />
      </div>
      <div className="fields-row">
        <Field label="Title" max={80} value={step.title}>
          <input value={step.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} className={!step.title.trim() ? 'invalid' : ''} />
        </Field>
        <Field label="Button" max={40} value={step.button}>
          <input value={step.button} maxLength={40} onChange={(e) => set({ button: e.target.value })} placeholder="Done" />
        </Field>
      </div>
      <Field label="What it says" max={1500} value={step.text}>
        <textarea rows={3} maxLength={1500} value={step.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      {step.kind === 'channels' && (
        <Field label="Channels to read">
          <ChannelPicker channels={channels} value={step.channelIds} onChange={(channelIds) => set({ channelIds })} />
        </Field>
      )}
    </div>
  );
}

function GuidePreview({ form, guild }) {
  const first = form.steps[0];
  const fill = (t) => (t ?? '').replaceAll('{user}', '@juan').replaceAll('{team}', 'Testers').replaceAll('{groupLink}', form.groupLink || form.defaultGroupLink);
  return (
    <div>
      <div className="preview-label"><span>What they see first</span></div>
      <div className="discord">
        <div className="discord-embed" style={{ borderColor: '#f08c1a', marginTop: 0 }}>
          <div className="discord-embed-author">{guild?.icon && <img src={guild.icon} alt="" />}{guild?.name ?? 'Piyesa Studios'}</div>
          {first ? (
            <>
              <div className="discord-embed-title">Step 1 of {form.steps.length} · {first.title}</div>
              <div className="discord-embed-desc">
                {form.intro && <>{renderMarkdown(fill(form.intro))}{'\n\n'}</>}
                {renderMarkdown(fill(first.text))}
                {first.kind === 'channels' && first.channelIds.length > 0 && `\n\n${first.channelIds.map((id) => `• #${guild?.channels.find((c) => c.id === id)?.name ?? 'channel'}`).join('\n')}`}
              </div>
              <div className="discord-embed-footer">Your progress: {form.steps.map((s, i) => `${i === 0 ? '➡️' : '⬜'} ${s.title}`).join('  ')}</div>
            </>
          ) : (
            <div className="discord-embed-desc">{renderMarkdown(fill(form.finish))}</div>
          )}
        </div>
        {first && (
          <div className="discord-buttons">
            <span className="discord-button" style={{ background: '#248046' }}>{first.button || 'Done'}</span>
            {first.kind === 'group' && <span className="discord-button">Open the community ↗</span>}
          </div>
        )}
      </div>
    </div>
  );
}

const pick = (g) => ({ enabled: g.enabled, intro: g.intro, finish: g.finish, groupLink: g.groupLink, fallbackChannelId: g.fallbackChannelId, steps: g.steps, defaultGroupLink: g.defaultGroupLink });

function Guide({ guildId, guide, guild, onOverview, onError }) {
  const toast = useToast();
  const [form, setForm] = useState(() => structuredClone(pick(guide)));
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(structuredClone(pick(guide))), [guide]);
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(guide));
  const nudge = useReportDirty(dirty);
  const channels = guild?.channels ?? [];
  const kindsTaken = new Set(form.steps.map((s) => s.kind));
  const setStep = (i, step) => setForm({ ...form, steps: form.steps.map((s, j) => (j === i ? step : s)) });
  const move = (i, d) => {
    const steps = [...form.steps];
    [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
    setForm({ ...form, steps });
  };
  const addStep = (kind) => setForm({
    ...form,
    steps: [...form.steps, {
      id: newId(), kind,
      title: { verify: 'Verify with Bloxlink', group: 'Join the community', channels: 'Read these channels', info: 'New step' }[kind],
      text: '', channelIds: [], button: kind === 'channels' ? 'I’ve read them' : 'Done',
    }],
  });
  const blocked = form.steps.some((s) => !s.title.trim()) ? 'Every step needs a title' : form.groupLink && !/^https?:\/\/\S+$/i.test(form.groupLink) ? 'The community link must start with https://' : null;

  async function save() {
    setBusy(true);
    try {
      const { defaultGroupLink, ...body } = form;
      onOverview(await api(`/guilds/${guildId}/team/onboarding/guide`, { method: 'PUT', body }));
      toast({ title: 'Saved', text: 'New guides use it; guides already sent keep their steps.' });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Not saved', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="The guide"
        description={<>Sent by DM to people you add. <code>{'{user}'}</code> mentions them, <code>{'{team}'}</code> is their group, <code>{'{groupLink}'}</code> the community link.</>}
        aside={<Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label={form.enabled ? 'On' : 'Off'} />}
        footer={
          <>
            {!kindsTaken.has('verify') && <Button variant="ghost" onClick={() => addStep('verify')}>+ Verify step</Button>}
            {!kindsTaken.has('group') && <Button variant="ghost" onClick={() => addStep('group')}>+ Community step</Button>}
            <Button variant="ghost" onClick={() => addStep('channels')}>+ Channels to read</Button>
            <Button icon="plus" disabled={form.steps.length >= 10} onClick={() => addStep('info')}>Add step</Button>
          </>
        }
      >
        <div className="split">
          <div>
            <Field label="Welcome (above the first step)" max={1000} value={form.intro}>
              <textarea rows={2} maxLength={1000} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
            </Field>
            <div className="guide-steps">
              {form.steps.map((s, i) => (
                <StepEditor
                  key={s.id}
                  step={s}
                  i={i}
                  count={form.steps.length}
                  channels={channels}
                  kindsTaken={kindsTaken}
                  onChange={(step) => setStep(i, step)}
                  onMove={(d) => move(i, d)}
                  onRemove={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}
                />
              ))}
              {!form.steps.length && <p className="subtle">No steps: people just get the finish message.</p>}
            </div>
            <Field label="When they’re done" max={1000} value={form.finish}>
              <textarea rows={2} maxLength={1000} value={form.finish} onChange={(e) => setForm({ ...form, finish: e.target.value })} />
            </Field>
          </div>
          <GuidePreview form={form} guild={guild} />
        </div>
      </Card>
      <Card title="Delivery">
        <div className="fields-row">
          <Field label="Community link" hint="Where the community step sends them.">
            <input type="url" value={form.groupLink} placeholder={form.defaultGroupLink} onChange={(e) => setForm({ ...form, groupLink: e.target.value.trim() })} />
          </Field>
          <Field label="If their DMs are closed" hint="The guide is posted here instead, mentioning them.">
            <select value={form.fallbackChannelId ?? ''} onChange={(e) => setForm({ ...form, fallbackChannelId: e.target.value || null })}>
              <option value="">Don’t send it</option>
              {channels.map((c) => <option key={c.id} value={c.id} disabled={!c.canPost}>#{c.name}{c.category ? ` · ${c.category}` : ''}</option>)}
            </select>
          </Field>
        </div>
      </Card>
      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={save} onDiscard={() => setForm(structuredClone(pick(guide)))} />
    </>
  );
}

// ------------------------------------------------------------------ the section
export default function TeamOnboarding({ guildId, guild, onTeam, onError }) {
  const [overview, setOverview] = useState(null);
  const [nav, setNav] = useUrlState({ part: 'progress' });
  useEffect(() => {
    api(`/guilds/${guildId}/team/onboarding`).then(setOverview).catch(onError);
  }, [guildId]);
  if (!overview) return <div className="skeleton" style={{ height: 240 }} />;
  const notRanked = overview.people.filter((p) => !p.ranked && p.status !== 'cancelled').length;
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <Segmented
          label="Onboarding"
          value={nav.part}
          onChange={(part) => setNav({ part })}
          options={[
            { value: 'progress', label: 'Progress', count: overview.people.filter((p) => p.status === 'active').length },
            { value: 'guide', label: 'The guide' },
          ]}
        />
        {notRanked > 0 && nav.part === 'progress' && (
          <span className="subtle"><Icon name="alert" width="14" height="14" /> {notRanked} not ranked yet</span>
        )}
      </div>
      {nav.part === 'guide' ? (
        <Guide guildId={guildId} guide={overview.guide} guild={guild} onOverview={setOverview} onError={onError} />
      ) : (
        <Progress guildId={guildId} people={overview.people} onOverview={setOverview} onTeam={onTeam} onError={onError} />
      )}
    </div>
  );
}
