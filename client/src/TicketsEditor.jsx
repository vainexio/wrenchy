import { useEffect, useMemo, useState } from 'react';
import { matchScore } from '../../src/shared/search.js';
import { slug, ticketName } from '../../src/shared/ticketName.js';
import { api } from './api.js';
import { useReportDirty } from './appContext.js';
import { RoleChips, renderMarkdown } from './PanelParts.jsx';
import {
  Badge, Button, Card, Empty, Field, FilterMenu, FilterSummary, Icon, LinkButton, Modal, Notice, PageHead, PageSkeleton,
  SaveBar, SearchInput, Segmented, Tabs, Toggle, ago, useConfirm, useToast,
} from './ui.jsx';
import { useUrlState } from './urlState.js';

// Tickets: kinds of ticket (each with its category, staff roles and channel names), the panels members open them
// from, settings, and every ticket with its transcript. The bot side is src/bot/tickets.js.

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const COLORS = [
  { value: 'primary', label: 'Blue', css: '#5865f2' },
  { value: 'secondary', label: 'Grey', css: '#4e5058' },
  { value: 'success', label: 'Green', css: '#248046' },
  { value: 'danger', label: 'Red', css: '#da373c' },
];

// (one click to a sensible start; everything stays editable)
const STARTERS = [
  {
    name: 'Content Creator Application', emoji: '🎥', style: 'primary', namePattern: 'cc-apps-{n}',
    description: 'Apply for the content creator role',
    welcome: 'Thanks for applying, {user}! Staff will look at your channel and get back to you here.',
    questions: [
      { label: 'Your channel link', placeholder: 'YouTube, TikTok…', long: false, required: true },
      { label: 'Followers / subscribers', placeholder: 'e.g. 12,000', long: false, required: true },
      { label: 'What would you make about the game?', placeholder: '', long: true, required: true },
    ],
  },
  {
    name: 'General Inquiry', emoji: '💬', style: 'secondary', namePattern: 'inquiry-{n}',
    description: 'Questions about anything else',
    welcome: 'Hi {user}! Tell us what you need and staff will be with you soon.', questions: [],
  },
  {
    name: 'Player Report', emoji: '🚩', style: 'danger', namePattern: 'player-report-{n}',
    description: 'Report a player breaking the rules',
    welcome: 'Thanks for the report, {user}. Add screenshots or clips here; staff will look into it.',
    questions: [
      { label: 'Their Roblox username', placeholder: '', long: false, required: true },
      { label: 'What happened?', placeholder: 'When, where, what they did', long: true, required: true },
    ],
  },
];

function blankType(overrides = {}) {
  return {
    id: newId(), name: 'New ticket type', emoji: '', style: 'primary', description: '', categoryId: null, staffRoleIds: [],
    namePattern: 'ticket-{n}', welcome: 'Thanks for opening a ticket, {user}! Staff will be with you soon.', questions: [],
    pingStaff: true, maxOpen: 1, nextNumber: 1, open: 0, ...overrides,
  };
}

function blankPanel(types) {
  return {
    id: newId(), name: 'Ticket panel', channelId: null, messageId: null, title: 'Need help?',
    description: 'Pick what your ticket is about and a private channel opens with our staff.', color: '#F08C1A',
    style: 'buttons', placeholder: 'Open a ticket…', typeIds: types.map((t) => t.id), url: null,
  };
}

/** What's saved, as the form edits it. */
const toForm = (c) => ({ settings: { ...c.settings }, types: structuredClone(c.types), panels: structuredClone(c.panels) });
/** What counts as a change (not the read-only extras the server adds). */
const comparable = (f) =>
  JSON.stringify({
    settings: f.settings,
    types: f.types.map(({ open, ...t }) => t),
    panels: f.panels.map(({ url, channelId, messageId, ...p }) => p),
  });

// ------------------------------------------------------------------ ticket types
function QuestionRow({ q, i, onChange, onRemove }) {
  return (
    <div className="question">
      <span className="question-n">{i + 1}</span>
      <input value={q.label} maxLength={45} placeholder="Question" aria-label={`Question ${i + 1}`} onChange={(e) => onChange({ label: e.target.value })} className={!q.label.trim() ? 'invalid' : ''} />
      <input value={q.placeholder} maxLength={100} placeholder="Hint (optional)" aria-label={`Question ${i + 1} hint`} onChange={(e) => onChange({ placeholder: e.target.value })} />
      <Toggle checked={q.long} onChange={(long) => onChange({ long })} label="Long" />
      <Toggle checked={q.required} onChange={(required) => onChange({ required })} label="Required" />
      <Button size="sm" variant="ghost-danger" icon="trash" title="Remove question" onClick={onRemove} />
    </div>
  );
}

function TypeEditor({ type, open, onToggle, onChange, onRemove, guild, categories }) {
  const set = (changes) => onChange({ ...type, ...changes });
  const category = categories.find((c) => c.id === type.categoryId);
  const preview = ticketName(type.namePattern, Number(type.nextNumber) || 1, 'juan');
  const setQuestion = (i, changes) => set({ questions: type.questions.map((q, j) => (j === i ? { ...q, ...changes } : q)) });
  // (the channel names follow the name while they're still the name's own)
  const rename = (name) => {
    const own = type.namePattern === `${slug(type.name)}-{n}` || type.namePattern === 'ticket-{n}';
    set({ name, ...(own && slug(name) ? { namePattern: `${slug(name)}-{n}` } : {}) });
  };
  return (
    <div className={`type-card${open ? ' open' : ''}`}>
      <button type="button" className="type-head" aria-expanded={open} onClick={onToggle}>
        <span className="type-emoji">{type.emoji || '🎫'}</span>
        <span className="grow">
          <b>{type.name || 'Unnamed'}</b>
          <small>
            #{preview} · {category ? category.name : 'no category'} · {type.staffRoleIds.length} staff {type.staffRoleIds.length === 1 ? 'role' : 'roles'}
            {type.questions.length ? ` · ${type.questions.length}-question form` : ''}
          </small>
        </span>
        {type.open > 0 && <Badge tone="ok">{type.open} open</Badge>}
        <Icon name="chevron" className={open ? 'flip' : ''} />
      </button>
      {open && (
        <div className="type-body">
          <div className="fields-row">
            <Field label="Name" hint="The button’s label." max={80} value={type.name}>
              <input value={type.name} maxLength={80} onChange={(e) => rename(e.target.value)} className={!type.name.trim() ? 'invalid' : ''} />
            </Field>
            <div className="row">
              <Field label="Emoji" className="small">
                <input value={type.emoji} maxLength={64} placeholder="none" onChange={(e) => set({ emoji: e.target.value })} />
              </Field>
              <Field label="Button colour" className="grow">
                <Segmented label="Button colour" value={type.style} onChange={(style) => set({ style })} options={COLORS.map((c) => ({ value: c.value, label: c.label }))} />
              </Field>
            </div>
          </div>
          <Field label="Description (optional)" hint="Shown under it in a dropdown panel." max={100} value={type.description}>
            <input value={type.description} maxLength={100} onChange={(e) => set({ description: e.target.value })} />
          </Field>

          <div className="fields-row">
            <Field label="Category" hint={category && category.channels >= 45 ? `${category.name} is nearly full (50 channels at most).` : 'Its tickets open in this category.'}>
              <select value={type.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.canManage}>
                    {c.name}
                    {c.canManage ? '' : ' (Wrenchy can’t make channels here)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Channel names" hint={<>Next one: <b>#{preview}</b>. <code>{'{n}'}</code> is its number, <code>{'{user}'}</code> their username.</>}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input value={type.namePattern} maxLength={90} onChange={(e) => set({ namePattern: e.target.value })} className={!type.namePattern.includes('{n}') ? 'invalid' : ''} aria-label="Channel names" />
                <input type="number" min="1" max="999999" title="Next number" aria-label="Next number" value={type.nextNumber} onChange={(e) => set({ nextNumber: e.target.value })} style={{ width: 100 }} />
              </div>
            </Field>
          </div>

          <Field label="Staff roles" hint="They see and handle these tickets. People who can manage channels always can.">
            <RoleChips roles={(guild?.roles ?? []).map((r) => ({ ...r, problem: null }))} value={type.staffRoleIds} onChange={(staffRoleIds) => set({ staffRoleIds })} addLabel="Add staff role…" />
          </Field>

          <Field label="Welcome message" hint={<><code>{'{user}'}</code> mentions them. The form’s answers show under it.</>} max={2000} value={type.welcome}>
            <textarea rows={3} maxLength={2000} value={type.welcome} onChange={(e) => set({ welcome: e.target.value })} />
          </Field>

          <Field label="Form before it opens (optional)" hint="Up to 5 questions, asked in a pop-up when they pick this type.">
            <div className="rows">
              {type.questions.map((q, i) => (
                <QuestionRow key={i} q={q} i={i} onChange={(c) => setQuestion(i, c)} onRemove={() => set({ questions: type.questions.filter((_, j) => j !== i) })} />
              ))}
              {type.questions.length < 5 && (
                <div>
                  <Button size="sm" icon="plus" onClick={() => set({ questions: [...type.questions, { label: '', placeholder: '', long: false, required: true }] })}>
                    Add question
                  </Button>
                </div>
              )}
            </div>
          </Field>

          <div className="row type-foot">
            <Toggle checked={type.pingStaff} onChange={(pingStaff) => set({ pingStaff })} label="Ping the staff roles when one opens" />
            <label className="inline-number">
              Open at once per member
              <input type="number" min="1" max="10" value={type.maxOpen} onChange={(e) => set({ maxOpen: e.target.value })} />
            </label>
            <span className="grow" />
            <Button variant="ghost-danger" icon="trash" onClick={onRemove}>
              Remove type
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Types({ form, setForm, guild, categories, confirm }) {
  const [openId, setOpenId] = useState(form.types.length === 1 ? form.types[0].id : null);
  const setType = (t) => setForm({ ...form, types: form.types.map((x) => (x.id === t.id ? t : x)) });
  const add = (overrides) => {
    const t = blankType(overrides);
    setForm({ ...form, types: [...form.types, t], panels: form.panels.map((p) => (form.types.length ? p : { ...p, typeIds: [...p.typeIds, t.id] })) });
    setOpenId(t.id);
  };
  const remove = async (t) => {
    if (!(await confirm({ title: `Remove ${t.name}?`, text: 'Its button comes off every panel. Tickets already open stay open.', confirmLabel: 'Remove', danger: true }))) return;
    setForm({ ...form, types: form.types.filter((x) => x.id !== t.id), panels: form.panels.map((p) => ({ ...p, typeIds: p.typeIds.filter((id) => id !== t.id) })) });
  };
  const unused = STARTERS.filter((s) => !form.types.some((t) => t.name === s.name));
  return (
    <Card
      title="Ticket types"
      description="Each kind of ticket members can open, with its own category, staff and channel names."
      bodyClass=""
      footer={
        <>
          {unused.map((s) => (
            <Button key={s.name} variant="ghost" onClick={() => add({ ...s, questions: structuredClone(s.questions) })}>
              + {s.name}
            </Button>
          ))}
          <Button icon="plus" disabled={form.types.length >= 25} onClick={() => add()}>
            New type
          </Button>
        </>
      }
    >
      {!form.types.length ? (
        <Empty icon="ticket" title="No ticket types yet">
          Start from one below, or make your own.
        </Empty>
      ) : (
        <div className="type-list">
          {form.types.map((t) => (
            <TypeEditor
              key={t.id}
              type={t}
              open={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              onChange={setType}
              onRemove={() => remove(t)}
              guild={guild}
              categories={categories}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ panels
function PanelPreview({ panel, types }) {
  const shown = panel.typeIds.map((id) => types.find((t) => t.id === id)).filter(Boolean);
  return (
    <div>
      <div className="preview-label"><span>Preview</span></div>
      <div className="discord">
        <div className="discord-embed" style={{ borderColor: panel.color, marginTop: 0 }}>
          {panel.title && <div className="discord-embed-title">{panel.title}</div>}
          {panel.description && <div className="discord-embed-desc">{renderMarkdown(panel.description)}</div>}
        </div>
        {!shown.length ? (
          <p className="placeholder" style={{ margin: '10px 0 0' }}>No ticket types on this panel yet.</p>
        ) : panel.style === 'menu' ? (
          <div className="discord-select">
            <span>{panel.placeholder || 'Open a ticket…'}</span>
            <Icon name="chevron" />
          </div>
        ) : (
          <div className="discord-buttons">
            {shown.map((t) => (
              <span key={t.id} className="discord-button" style={{ background: COLORS.find((c) => c.value === t.style)?.css }}>
                {t.emoji && <span>{t.emoji}</span>}
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelEditor({ panel, types, guild, saved, onChange, onRemove, onPost }) {
  const set = (changes) => onChange({ ...panel, ...changes });
  const [channelId, setChannelId] = useState(panel.channelId ?? '');
  const [posting, setPosting] = useState(false);
  useEffect(() => setChannelId((c) => panel.channelId ?? c), [panel.channelId]);
  const on = (id) => panel.typeIds.includes(id);
  const toggle = (id) => set({ typeIds: on(id) ? panel.typeIds.filter((x) => x !== id) : [...panel.typeIds, id] });
  const move = (id, step) => {
    const ids = [...panel.typeIds];
    const i = ids.indexOf(id);
    [ids[i], ids[i + step]] = [ids[i + step], ids[i]];
    set({ typeIds: ids });
  };
  const ordered = [...panel.typeIds.map((id) => types.find((t) => t.id === id)).filter(Boolean), ...types.filter((t) => !on(t.id))];
  const current = guild?.channels.find((c) => c.id === panel.channelId);
  return (
    <Card
      title={panel.name || 'Panel'}
      aside={panel.url ? <Badge tone="ok" dot>Posted in #{current?.name ?? 'a channel'}</Badge> : <Badge dot>Not posted yet</Badge>}
      footer={
        <>
          <Field label="Post in" className="grow">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">Pick a channel…</option>
              {(guild?.channels ?? []).map((c) => (
                <option key={c.id} value={c.id} disabled={!c.canPost}>
                  #{c.name}{c.category ? ` · ${c.category}` : ''}{c.canPost ? '' : ' (Wrenchy can’t post here)'}
                </option>
              ))}
            </select>
          </Field>
          <div className="row" style={{ alignSelf: 'flex-end' }}>
            {panel.url && <LinkButton href={panel.url}>View</LinkButton>}
            <Button
              variant="primary"
              icon="send"
              loading={posting}
              disabled={!channelId || !saved || !panel.typeIds.length}
              title={!saved ? 'Save your changes first' : undefined}
              onClick={async () => {
                setPosting(true);
                await onPost(panel, channelId);
                setPosting(false);
              }}
            >
              {panel.url ? 'Re-post' : 'Post panel'}
            </Button>
          </div>
        </>
      }
    >
      <div className="split">
        <div>
          <Field label="Name" hint="Only you see this." max={60} value={panel.name}>
            <input value={panel.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="row">
            <Field label="Title" className="grow" max={256} value={panel.title}>
              <input value={panel.title} maxLength={256} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Colour" className="small">
              <input type="color" value={panel.color} onChange={(e) => set({ color: e.target.value })} />
            </Field>
          </div>
          <Field label="Message" max={4000} value={panel.description}>
            <textarea rows={3} maxLength={4000} value={panel.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Members pick with">
            <Segmented label="Panel style" value={panel.style} onChange={(style) => set({ style })} options={[{ value: 'buttons', label: 'Buttons' }, { value: 'menu', label: 'A dropdown' }]} />
          </Field>
          {panel.style === 'menu' && (
            <Field label="Dropdown prompt" max={150} value={panel.placeholder}>
              <input value={panel.placeholder} maxLength={150} onChange={(e) => set({ placeholder: e.target.value })} />
            </Field>
          )}
          <Field label="Ticket types on this panel" hint="Ticked ones show, in this order.">
            <div className="panel-types">
              {ordered.map((t) => (
                <div key={t.id} className={`panel-type${on(t.id) ? ' on' : ''}`}>
                  <label>
                    <input type="checkbox" className="check" checked={on(t.id)} onChange={() => toggle(t.id)} />
                    <span>{t.emoji} {t.name}</span>
                  </label>
                  {on(t.id) && (
                    <span className="role-button-tools">
                      <Button size="sm" variant="ghost" icon="up" title="Move up" disabled={panel.typeIds.indexOf(t.id) === 0} onClick={() => move(t.id, -1)} />
                      <Button size="sm" variant="ghost" icon="down" title="Move down" disabled={panel.typeIds.indexOf(t.id) === panel.typeIds.length - 1} onClick={() => move(t.id, 1)} />
                    </span>
                  )}
                </div>
              ))}
              {!types.length && <span className="subtle">Make a ticket type first.</span>}
            </div>
          </Field>
          <div>
            <Button variant="ghost-danger" icon="trash" onClick={onRemove}>
              Remove panel
            </Button>
          </div>
        </div>
        <PanelPreview panel={panel} types={types} />
      </div>
    </Card>
  );
}

function Panels({ form, setForm, guild, savedPanels, dirty, confirm, onPost }) {
  const setPanel = (p) => setForm({ ...form, panels: form.panels.map((x) => (x.id === p.id ? p : x)) });
  return (
    <div className="stack">
      {form.panels.map((p) => (
        <PanelEditor
          key={p.id}
          panel={p}
          types={form.types}
          guild={guild}
          saved={!dirty && savedPanels.has(p.id)}
          onChange={setPanel}
          onPost={onPost}
          onRemove={async () => {
            const ok = !p.url || (await confirm({ title: `Remove ${p.name}?`, text: 'Its message in Discord is deleted when you save.', confirmLabel: 'Remove', danger: true }));
            if (ok) setForm({ ...form, panels: form.panels.filter((x) => x.id !== p.id) });
          }}
        />
      ))}
      {!form.panels.length && (
        <Card>
          <Empty icon="send" title="No panels yet">
            A panel is the message members open tickets from: buttons or a dropdown, posted in a channel.
          </Empty>
        </Card>
      )}
      <div>
        <Button icon="plus" disabled={form.panels.length >= 10} onClick={() => setForm({ ...form, panels: [...form.panels, blankPanel(form.types)] })}>
          New panel
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings
function Settings({ form, setForm, guild, categories, bot }) {
  const s = form.settings;
  const set = (changes) => setForm({ ...form, settings: { ...s, ...changes } });
  const checks = [
    ['Manage Channels', bot.manageChannels, 'to open, move and delete ticket channels'],
    ['Manage Roles', bot.manageRoles, 'to set who can see each ticket'],
    ['Attach Files', bot.attachFiles, 'to send transcripts'],
  ];
  return (
    <div className="stack">
      <Card title="Closing tickets" description="Closing saves a transcript of everything said, with a summary: who, when, why, and what was said.">
        <div className="field">
          <Toggle
            checked={s.deleteOnClose}
            onChange={(deleteOnClose) => set({ deleteOnClose })}
            label="Delete the channel 5 seconds after it’s closed"
            description="Off: closed tickets stay (read-only) and can be reopened."
          />
        </div>
        <Field label="Post transcripts in" hint="The summary and the full transcript file.">
          <select value={s.transcriptChannelId ?? ''} onChange={(e) => set({ transcriptChannelId: e.target.value || null })}>
            <option value="">Nowhere</option>
            {(guild?.channels ?? []).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.canPost}>#{c.name}{c.category ? ` · ${c.category}` : ''}</option>
            ))}
          </select>
        </Field>
        {!s.deleteOnClose && (
          <Field label="Closed tickets move to" hint="So open ones are easy to find. They stay readable for staff.">
            <select value={s.closedCategoryId ?? ''} onChange={(e) => set({ closedCategoryId: e.target.value || null })}>
              <option value="">Nowhere (they stay where they are)</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <div className="field">
          <Toggle checked={s.dmTranscript} onChange={(dmTranscript) => set({ dmTranscript })} label="DM the transcript to whoever opened it" />
        </div>
      </Card>
      <Card title="What Wrenchy needs" description="Server permissions for tickets.">
        <ul className="checklist">
          {checks.map(([name, ok, why]) => (
            <li key={name} className={ok ? 'ok' : 'bad'}>
              <Icon name={ok ? 'check' : 'alert'} /> <b>{name}</b> <span className="subtle">{why}</span>
            </li>
          ))}
          <li>
            <Icon name="info" /> <b>Message Content Intent</b>{' '}
            <span className="subtle">on in the Developer Portal (Bot → Privileged Gateway Intents), or transcripts come out without the messages’ text.</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ the tickets
const STATUS = { open: { label: 'Open', tone: 'ok' }, closed: { label: 'Closed', tone: '' }, deleted: { label: 'Deleted', tone: 'bad' } };

function TranscriptModal({ guildId, ticket, onClose, onError }) {
  const [full, setFull] = useState(null);
  useEffect(() => {
    api(`/guilds/${guildId}/tickets/${ticket.id}`).then(setFull).catch(onError);
  }, [ticket.id]);
  return (
    <Modal title={`#${ticket.name}`} wide onClose={onClose} actions={<Button onClick={onClose}>Close</Button>}>
      <p className="muted" style={{ marginTop: 0 }}>
        {ticket.typeName} · opened by {ticket.openerName} {ago(ticket.createdAt)}
        {ticket.closedAt ? ` · closed by ${ticket.closedBy?.name} ${ago(ticket.closedAt)}` : ''}
        {ticket.closeReason ? ` · “${ticket.closeReason}”` : ''}
      </p>
      {!full ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div className="transcript">
          {full.answers?.length > 0 && (
            <div className="transcript-answers">
              {full.answers.map((a, i) => (
                <div key={i}><b>{a.question}</b><div>{a.answer || '—'}</div></div>
              ))}
            </div>
          )}
          {!full.transcript.length && <p className="subtle">No transcript: it’s saved when the ticket closes.</p>}
          {full.transcript.map((m, i) => (
            <div key={i} className="t-msg">
              {m.avatar ? <img src={m.avatar} alt="" /> : <span className="avatar-xs">{m.author?.[0]}</span>}
              <div className="grow">
                <div className="t-who">
                  <b>{m.author}</b>
                  {m.bot && <span className="discord-bot">BOT</span>}
                  <span className="subtle">{new Date(m.at).toLocaleString()}</span>
                </div>
                {m.content ? <div className="t-text">{m.content}</div> : !m.embeds.length && !m.attachments.length && <div className="subtle">(no text)</div>}
                {m.embeds.map((e, j) => (
                  <div key={j} className="t-embed">{e.title && <b>{e.title}</b>}{e.description && <div>{e.description}</div>}</div>
                ))}
                {m.attachments.map((a, j) => (
                  <a key={j} href={a.url} target="_blank" rel="noreferrer" className="t-file">📎 {a.name}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function TicketList({ guildId, types, onError }) {
  const [tickets, setTickets] = useState(null);
  const [f, setF] = useUrlState({ find: '', state: '', kinds: [] });
  const [viewing, setViewing] = useState(null);
  useEffect(() => {
    api(`/guilds/${guildId}/tickets`).then(setTickets).catch(onError);
  }, [guildId]);
  const names = useMemo(() => new Map(types.map((t) => [t.id, t.name])), [types]);
  if (!tickets) return <div className="skeleton" style={{ height: 240 }} />;
  const kindName = (t) => names.get(t.typeId) ?? t.typeName;
  const shown = tickets.filter(
    (t) =>
      (!f.state || t.status === f.state) &&
      (!f.kinds.length || f.kinds.includes(t.typeId)) &&
      (!f.find.trim() || matchScore([t.name, t.openerName, t.openerId, String(t.number), t.claimedBy?.name, t.closeReason], f.find) !== null),
  );
  const kinds = [...new Map(tickets.map((t) => [t.typeId, kindName(t)])).entries()];
  const chips = [
    f.find.trim() && { key: 'find', label: `“${f.find.trim()}”`, onRemove: () => setF({ find: '' }) },
    f.state && { key: 'state', label: STATUS[f.state].label, onRemove: () => setF({ state: '' }) },
    ...f.kinds.map((k) => ({ key: k, label: names.get(k) ?? k, onRemove: () => setF({ kinds: f.kinds.filter((x) => x !== k) }) })),
  ].filter(Boolean);
  return (
    <Card bodyClass="">
      <div className="list-toolbar">
        <SearchInput value={f.find} onChange={(v) => setF({ find: v })} placeholder="Search a ticket, number or member…" className="grow" />
        <div className="toolbar-group">
          <FilterMenu label="Status" value={f.state} onChange={(v) => setF({ state: v })}
            options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label, count: tickets.filter((t) => t.status === value).length }))} />
          <FilterMenu label="Type" multi value={f.kinds} onChange={(v) => setF({ kinds: v })}
            options={kinds.map(([value, label]) => ({ value, label, count: tickets.filter((t) => t.typeId === value).length }))} />
        </div>
      </div>
      <FilterSummary shown={shown.length} total={tickets.length} noun="tickets" chips={chips} onClear={() => setF({ find: '', state: '', kinds: [] })} />
      {!tickets.length ? (
        <Empty icon="ticket" title="No tickets yet">
          Set up a ticket type and post a panel; tickets members open show up here.
        </Empty>
      ) : !shown.length ? (
        <Empty icon="search" title="No tickets match" />
      ) : (
        <ul className="list">
          {shown.slice(0, 200).map((t) => (
            <li key={t.id}>
              <div className="grow ticket-main">
                <div className="who-names">
                  <strong>#{t.name}</strong>
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                </div>
                <div className="who-sub">
                  {kindName(t)} · {t.openerName} · opened {ago(t.createdAt)}
                  {t.claimedBy?.name ? ` · ${t.claimedBy.name} handling` : ''}
                  {t.closedAt ? ` · closed ${ago(t.closedAt)} by ${t.closedBy?.name}` : ''}
                  {t.closeReason ? ` · “${t.closeReason}”` : ''}
                </div>
              </div>
              {t.messages > 0 && (
                <Button size="sm" icon="file" onClick={() => setViewing(t)}>
                  Transcript
                </Button>
              )}
              {t.url && <LinkButton href={t.url} size="sm">Open</LinkButton>}
            </li>
          ))}
        </ul>
      )}
      {viewing && <TranscriptModal guildId={guildId} ticket={viewing} onClose={() => setViewing(null)} onError={onError} />}
    </Card>
  );
}

// ------------------------------------------------------------------ the tab
export default function TicketsEditor({ guildId, onError }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [config, setConfig] = useState(null);
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [nav, setNav] = useUrlState({ view: 'tickets' });

  const apply = (c) => {
    setConfig(c);
    setForm(toForm(c));
  };
  const load = () => {
    setError(null);
    Promise.all([api(`/guilds/${guildId}/tickets/config`), api(`/guilds/${guildId}`)])
      .then(([c, g]) => {
        apply(c);
        setGuild(g);
      })
      .catch((err) => {
        onError(err);
        setError(err);
      });
  };
  useEffect(load, [guildId]);

  const dirty = Boolean(form && config && comparable(form) !== comparable(toForm(config)));
  const nudge = useReportDirty(dirty);
  if (!config || !form) return <PageSkeleton error={error} onRetry={load} />;

  const blocked = form.types.some((t) => !t.name.trim())
    ? 'Every ticket type needs a name'
    : form.types.some((t) => !t.namePattern.includes('{n}'))
      ? 'Channel names need {n} (the ticket’s number)'
      : form.types.some((t) => t.questions.some((q) => !q.label.trim()))
        ? 'Every form question needs text'
        : null;

  async function save() {
    setBusy(true);
    try {
      const body = {
        settings: form.settings,
        types: form.types.map(({ open, ...t }) => ({ ...t, nextNumber: Number(t.nextNumber), maxOpen: Number(t.maxOpen) })),
        panels: form.panels.map(({ url, ...p }) => p),
      };
      const { warnings, ...next } = await api(`/guilds/${guildId}/tickets/config`, { method: 'PUT', body });
      apply(next);
      toast(warnings.length ? { tone: 'error', title: 'Saved, but…', text: warnings.join(' ') } : { title: 'Saved', text: next.panels.some((p) => p.url) ? 'Posted panels were updated too.' : undefined });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Not saved', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function post(panel, channelId) {
    try {
      apply(await api(`/guilds/${guildId}/tickets/panels/${panel.id}/post`, { method: 'POST', body: { channelId } }));
      const channel = guild?.channels.find((c) => c.id === channelId);
      toast({ title: `Posted in #${channel?.name ?? 'the channel'}` });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Not posted', text: err.message });
    }
  }

  const view = ['tickets', 'types', 'panels', 'settings'].includes(nav.view) ? nav.view : 'tickets';
  const openCount = config.types.reduce((n, t) => n + t.open, 0);
  return (
    <>
      <PageHead title="Tickets" description="Private channels between a member and your staff, opened from a panel.">
        <Toggle checked={form.settings.enabled} onChange={(enabled) => setForm({ ...form, settings: { ...form.settings, enabled } })} label={form.settings.enabled ? 'On' : 'Off'} />
      </PageHead>
      <Tabs
        label="Ticket sections"
        value={view}
        onChange={(v) => setNav({ view: v })}
        tabs={[
          { value: 'tickets', label: 'Tickets', icon: 'ticket', count: openCount },
          { value: 'types', label: 'Ticket types', icon: 'tag', count: form.types.length },
          { value: 'panels', label: 'Panels', icon: 'send', count: form.panels.length },
          { value: 'settings', label: 'Settings', icon: 'gear' },
        ]}
      />
      {!config.bot.manageChannels && (
        <Notice tone="warn">Wrenchy needs the <b>Manage Channels</b> permission to open tickets. Give its role that permission in Server Settings → Roles.</Notice>
      )}
      <div className="stack">
        {view === 'tickets' && <TicketList guildId={guildId} types={config.types} onError={onError} />}
        {view === 'types' && <Types form={form} setForm={setForm} guild={guild} categories={config.categories} confirm={confirm} />}
        {view === 'panels' && (
          <Panels form={form} setForm={setForm} guild={guild} savedPanels={new Set(config.panels.map((p) => p.id))} dirty={dirty} confirm={confirm} onPost={post} />
        )}
        {view === 'settings' && <Settings form={form} setForm={setForm} guild={guild} categories={config.categories} bot={config.bot} />}
      </div>
      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={save} onDiscard={() => setForm(toForm(config))} />
    </>
  );
}
