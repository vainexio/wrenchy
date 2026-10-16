import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Loading, Notice, renderMarkdown } from './PanelParts.jsx';

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

function AnnouncementPreview({ form, roles }) {
  const ping = form.mention !== 'none' ? mentionLabel(form.mention, roles) : '';
  const e = form.embed;
  const embedHasContent = e.title || e.description;
  return (
    <div className="discord">
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
              {!embedHasContent && <div className="muted">Add a title or description…</div>}
            </div>
            {e.thumbnailUrl && <img className="discord-embed-thumb" src={e.thumbnailUrl} alt="" />}
          </div>
          {e.imageUrl && <img className="discord-embed-image" src={e.imageUrl} alt="" />}
          {(e.footer || e.timestamp) && (
            <div className="discord-embed-footer">
              {[e.footer, e.timestamp && 'Today at the time it’s sent'].filter(Boolean).join(' • ')}
            </div>
          )}
        </div>
      )}
      {form.mode === 'text' && !form.content && !ping && <div className="muted">Your message will appear here…</div>}
    </div>
  );
}

export default function AnnouncementEditor({ guildId, onError }) {
  const [guild, setGuild] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState(() => loadDraft(guildId));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    Promise.all([api(`/guilds/${guildId}`), api(`/guilds/${guildId}/announcements`)])
      .then(([g, h]) => {
        setGuild(g);
        setHistory(h);
      })
      .catch(onError);
  }, [guildId]);

  useEffect(() => saveDraft(guildId, form), [guildId, form]);

  if (!guild) return <Loading />;

  const set = (key) => (ev) => setForm({ ...form, [key]: ev.target.value });
  const setEmbed = (key) => (ev) =>
    setForm({ ...form, embed: { ...form.embed, [key]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value } });

  const channel = guild.channels.find((c) => c.id === form.channelId);
  const canSend =
    channel && (form.mode === 'text' ? form.content.trim() : form.embed.title.trim() || form.embed.description.trim());

  async function send(ev) {
    ev.preventDefault();
    const ping = form.mention !== 'none' ? ` and ping ${mentionLabel(form.mention, guild.roles)}` : '';
    if (!window.confirm(`Send this ${form.mode === 'embed' ? 'embed' : 'message'} to #${channel.name}${ping}?`)) return;

    setBusy(true);
    setNotice(null);
    try {
      const result = await api(`/guilds/${guildId}/announcements`, { method: 'POST', body: form });
      setHistory(result.history);
      setNotice({ type: 'ok', text: 'Sent!', url: result.url });
      setForm({ ...EMPTY, channelId: form.channelId, mode: form.mode, embed: { ...EMPTY.embed, color: form.embed.color } });
    } catch (err) {
      onError(err);
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="editor" onSubmit={send}>
      <section className="card">
        <div className="card-head">
          <h2>Announcement</h2>
          <div className="segmented" role="radiogroup" aria-label="Message type">
            {[
              ['text', 'Normal message'],
              ['embed', 'Embed'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={form.mode === mode}
                className={form.mode === mode ? 'active' : ''}
                onClick={() => setForm({ ...form, mode })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <label className="field grow">
            <span>Channel</span>
            <select value={form.channelId} onChange={set('channelId')} required>
              <option value="">Select a channel…</option>
              {guild.channels.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.canPost}>
                  #{c.name}
                  {c.category ? ` (${c.category})` : ''}
                  {c.canPost ? '' : ' (no permission)'}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Ping</span>
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
          </label>
        </div>

        <div className="split">
          <div className="fields">
            <label className="field">
              <span>{form.mode === 'embed' ? 'Text above the embed (optional)' : 'Message'}</span>
              <textarea
                rows={form.mode === 'embed' ? 2 : 8}
                value={form.content}
                maxLength={2000}
                onChange={set('content')}
                required={form.mode === 'text'}
              />
              <small className="muted">Supports Discord formatting like **bold**, *italic*, # headings and links.</small>
            </label>

            {form.mode === 'embed' && (
              <>
                <div className="row">
                  <label className="field grow">
                    <span>Title</span>
                    <input value={form.embed.title} maxLength={256} onChange={setEmbed('title')} />
                  </label>
                  <label className="field small">
                    <span>Color</span>
                    <input type="color" value={form.embed.color} onChange={setEmbed('color')} />
                  </label>
                </div>
                <label className="field">
                  <span>Description</span>
                  <textarea rows={6} value={form.embed.description} maxLength={4096} onChange={setEmbed('description')} />
                </label>
                <label className="field">
                  <span>Title link (optional)</span>
                  <input type="url" value={form.embed.url} onChange={setEmbed('url')} placeholder="https://" />
                </label>
                <div className="row">
                  <label className="field grow">
                    <span>Image (optional)</span>
                    <input type="url" value={form.embed.imageUrl} onChange={setEmbed('imageUrl')} placeholder="https://" />
                  </label>
                  <label className="field grow">
                    <span>Thumbnail (optional)</span>
                    <input
                      type="url"
                      value={form.embed.thumbnailUrl}
                      onChange={setEmbed('thumbnailUrl')}
                      placeholder="https://"
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Footer (optional)</span>
                  <input value={form.embed.footer} maxLength={2048} onChange={setEmbed('footer')} />
                </label>
                <label className="switch field-inline">
                  <input type="checkbox" checked={form.embed.timestamp} onChange={setEmbed('timestamp')} />
                  <span>Show time sent</span>
                </label>
              </>
            )}
          </div>
          <div className="preview">
            <span className="field-label">Preview</span>
            <AnnouncementPreview form={form} roles={guild.roles} />
          </div>
        </div>

        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !canSend}>
            {busy ? 'Sending…' : channel ? `Send to #${channel.name}` : 'Send'}
          </button>
          <button type="button" disabled={busy} onClick={() => setForm({ ...EMPTY, channelId: form.channelId })}>
            Clear
          </button>
        </div>
      </section>

      {notice && (
        <div className={`notice ${notice.type}`}>
          {notice.text}{' '}
          {notice.url && (
            <a href={notice.url} target="_blank" rel="noreferrer">
              View in Discord
            </a>
          )}
        </div>
      )}

      <section className="card">
        <h2>Recent announcements</h2>
        {history.length === 0 && <p className="muted">Nothing sent yet.</p>}
        <ul className="history">
          {history.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" className="grow">
                {a.summary || '(no text)'}
              </a>
              <span className="muted">
                #{a.channelName} · {a.mode === 'embed' ? 'Embed' : 'Message'} · {a.sentBy} ·{' '}
                {new Date(a.sentAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </form>
  );
}
