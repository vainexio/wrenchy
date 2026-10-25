import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useBot } from './appContext.js';
import { DiscordMessage, renderMarkdown } from './PanelParts.jsx';
import { Badge, Button, Card, Empty, Field, PageHead, PageSkeleton, Segmented, Toggle, ago, useConfirm, useToast } from './ui.jsx';

const EMPTY = {
  channelId: '',
  mode: 'text',
  mention: 'none',
  content: '',
  embed: { title: '', description: '', color: '#F5A623', url: '', imageUrl: '', thumbnailUrl: '', footer: '', timestamp: false },
};

const DRAFT_KEY = (guildId) => `wrenchy:announcement-draft:${guildId}`;

function loadDraft(guildId) {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY(guildId)));
    return saved ? { ...EMPTY, ...saved, embed: { ...EMPTY.embed, ...saved.embed } } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveDraft(guildId, form) {
  try {
    localStorage.setItem(DRAFT_KEY(guildId), JSON.stringify(form));
  } catch {
    // Drafts are a convenience; ignore storage errors.
  }
}

function mentionLabel(mention, roles) {
  if (mention === 'everyone' || mention === 'here') return `@${mention}`;
  const role = roles.find((r) => r.id === mention);
  return role ? `@${role.name}` : '';
}

const isEmpty = (form) =>
  !form.content.trim() && !form.embed.title.trim() && !form.embed.description.trim() && !form.embed.imageUrl && form.mention === 'none';

function AnnouncementPreview({ bot, form, roles }) {
  const ping = form.mention !== 'none' ? mentionLabel(form.mention, roles) : '';
  const e = form.embed;
  const embedHasContent = e.title || e.description;
  return (
    <div>
      <div className="preview-label">
        <span>Preview</span>
      </div>
      <div className="discord">
        <DiscordMessage bot={bot}>
          {(ping || form.content) && (
            <div className="discord-content">
              {ping && <span className="discord-mention">{ping}</span>}
              {ping && form.content && (form.mode === 'text' ? ' ' : <br />)}
              {renderMarkdown(form.content)}
            </div>
          )}
          {form.mode === 'embed' && (
            <div className="discord-embed" style={{ borderColor: e.color }}>
              <div className="discord-embed-body">
                <div className="grow">
                  {e.title && <div className={`discord-embed-title${e.url ? ' linked' : ''}`}>{e.title}</div>}
                  {e.description && <div className="discord-embed-desc">{renderMarkdown(e.description)}</div>}
                  {!embedHasContent && <div className="placeholder">Add a title or description…</div>}
                </div>
                {e.thumbnailUrl && <img className="discord-embed-thumb" src={e.thumbnailUrl} alt="" />}
              </div>
              {e.imageUrl && <img className="discord-embed-image" src={e.imageUrl} alt="" />}
              {(e.footer || e.timestamp) && (
                <div className="discord-embed-footer">{[e.footer, e.timestamp && 'Today at the time it’s sent'].filter(Boolean).join(' • ')}</div>
              )}
            </div>
          )}
          {form.mode === 'text' && !form.content && !ping && <div className="discord-content placeholder">Your message will appear here…</div>}
        </DiscordMessage>
      </div>
    </div>
  );
}

export default function AnnouncementEditor({ guildId, onError }) {
  const bot = useBot();
  const toast = useToast();
  const confirm = useConfirm();
  const [guild, setGuild] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState(() => loadDraft(guildId));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api(`/guilds/${guildId}`), api(`/guilds/${guildId}/announcements`)])
      .then(([g, h]) => {
        setGuild(g);
        setHistory(h);
      })
      .catch(onError);
  }, [guildId]);

  useEffect(() => saveDraft(guildId, form), [guildId, form]);

  if (!guild) return <PageSkeleton />;

  const set = (key) => (ev) => setForm({ ...form, [key]: ev.target.value });
  const setEmbed = (key) => (ev) =>
    setForm({ ...form, embed: { ...form.embed, [key]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value } });

  const channel = guild.channels.find((c) => c.id === form.channelId);
  const hasBody = form.mode === 'text' ? form.content.trim() : form.embed.title.trim() || form.embed.description.trim();
  const why = !channel ? 'Pick a channel first' : !hasBody ? (form.mode === 'text' ? 'Write a message first' : 'Give the embed a title or description') : null;
  const ping = form.mention !== 'none' ? mentionLabel(form.mention, guild.roles) : '';

  async function send(ev) {
    ev?.preventDefault();
    if (why) return;
    const ok = await confirm({
      title: `Send to #${channel.name}?`,
      text: `${form.mode === 'embed' ? 'The embed' : 'The message'} goes out right away${ping ? ` and pings ${ping}` : ''}. It can’t be unsent from here.`,
      confirmLabel: ping ? `Send and ping ${ping}` : 'Send now',
      danger: ping === '@everyone' || ping === '@here',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api(`/guilds/${guildId}/announcements`, { method: 'POST', body: form });
      setHistory(result.history);
      toast({ title: `Sent to #${channel.name}`, link: result.url ? { href: result.url, label: 'View in Discord' } : undefined });
      setForm({ ...EMPTY, channelId: form.channelId, mode: form.mode, embed: { ...EMPTY.embed, color: form.embed.color } });
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'Not sent', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!isEmpty(form) && !(await confirm({ title: 'Clear this draft?', text: 'The text, embed and ping are wiped. The channel stays picked.', confirmLabel: 'Clear draft', danger: true }))) return;
    setForm({ ...EMPTY, channelId: form.channelId });
  }

  return (
    <>
      <PageHead title="Announcements" description="Send a message or an embed from Wrenchy to any channel. Your draft is kept in this browser until you send it.">
        <Segmented
          label="Message type"
          value={form.mode}
          onChange={(mode) => setForm({ ...form, mode })}
          options={[
            { value: 'text', label: 'Message' },
            { value: 'embed', label: 'Embed' },
          ]}
        />
      </PageHead>

      <form className="stack" onSubmit={send}>
        <Card
          title="Compose"
          footer={
            <>
              <span className="grow subtle" style={{ alignSelf: 'center' }}>
                {why ?? `Goes to #${channel.name}${ping ? ` · pings ${ping}` : ''}`}
              </span>
              <Button variant="ghost" disabled={busy} onClick={clear}>
                Clear
              </Button>
              <Button type="submit" variant="primary" icon="send" loading={busy} disabled={Boolean(why)}>
                {channel ? `Send to #${channel.name}` : 'Send'}
              </Button>
            </>
          }
        >
          <div className="fields-row">
            <Field label="Channel">
              <select value={form.channelId} onChange={set('channelId')}>
                <option value="">Pick a channel…</option>
                {guild.channels.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.canPost}>
                    #{c.name}
                    {c.category ? ` · ${c.category}` : ''}
                    {c.canPost ? '' : ' (Wrenchy can’t post here)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ping" hint={form.mention === 'everyone' || form.mention === 'here' ? 'Pings everyone who can see the channel.' : undefined}>
              <select value={form.mention} onChange={set('mention')}>
                <option value="none">No ping</option>
                <option value="everyone">@everyone</option>
                <option value="here">@here</option>
                {guild.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    @{r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="divider" />

          <div className="split">
            <div>
              <Field
                label={form.mode === 'embed' ? 'Text above the embed (optional)' : 'Message'}
                max={2000}
                value={form.content}
                hint="Discord formatting works: **bold**, *italic*, # headings and links."
              >
                <textarea rows={form.mode === 'embed' ? 2 : 8} value={form.content} maxLength={2000} onChange={set('content')} />
              </Field>

              {form.mode === 'embed' && (
                <>
                  <div className="row">
                    <Field label="Title" className="grow" max={256} value={form.embed.title}>
                      <input value={form.embed.title} maxLength={256} onChange={setEmbed('title')} />
                    </Field>
                    <Field label="Colour" className="small">
                      <input type="color" value={form.embed.color} onChange={setEmbed('color')} />
                    </Field>
                  </div>
                  <Field label="Description" max={4096} value={form.embed.description}>
                    <textarea rows={6} value={form.embed.description} maxLength={4096} onChange={setEmbed('description')} />
                  </Field>
                  <Field label="Title link (optional)">
                    <input type="url" value={form.embed.url} onChange={setEmbed('url')} placeholder="https://" />
                  </Field>
                  <div className="fields-row">
                    <Field label="Image (optional)">
                      <input type="url" value={form.embed.imageUrl} onChange={setEmbed('imageUrl')} placeholder="https://" />
                    </Field>
                    <Field label="Thumbnail (optional)">
                      <input type="url" value={form.embed.thumbnailUrl} onChange={setEmbed('thumbnailUrl')} placeholder="https://" />
                    </Field>
                  </div>
                  <Field label="Footer (optional)" max={2048} value={form.embed.footer}>
                    <input value={form.embed.footer} maxLength={2048} onChange={setEmbed('footer')} />
                  </Field>
                  <div className="field">
                    <Toggle checked={form.embed.timestamp} onChange={(timestamp) => setForm({ ...form, embed: { ...form.embed, timestamp } })} label="Show the time it was sent" />
                  </div>
                </>
              )}
            </div>
            <AnnouncementPreview bot={bot} form={form} roles={guild.roles} />
          </div>
        </Card>

        <Card title="Recent announcements" bodyClass="" aside={<Badge>{history.length}</Badge>}>
          {history.length === 0 ? (
            <Empty icon="megaphone" title="Nothing sent yet">
              Announcements you send show up here.
            </Empty>
          ) : (
            <ul className="list">
              {history.map((a) => (
                <li key={a.id}>
                  <div className="grow">
                    <a href={a.url} target="_blank" rel="noreferrer" className="history-text" title="Open in Discord">
                      {a.summary || '(no text)'}
                    </a>
                    <div className="history-meta">
                      <span className="pill">#{a.channelName}</span>
                      <span className="pill">{a.mode === 'embed' ? 'Embed' : 'Message'}</span>
                      <span>by {a.sentBy}</span>
                      <span title={new Date(a.sentAt).toLocaleString()}>· {ago(a.sentAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </form>
    </>
  );
}
