// Building blocks shared by the panel editors.

const CUSTOM_EMOJI = /^<(a?):(\w+):(\d+)>$/;

/** Shows a custom server emoji (<:name:id>) as its image; unicode emoji as-is. */
function Emoji({ value }) {
  const match = value.match(CUSTOM_EMOJI);
  if (!match) return <span>{value}</span>;
  const [, animated, name, id] = match;
  return (
    <img
      className="emoji"
      src={`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=48`}
      alt={`:${name}:`}
      title={`:${name}:`}
    />
  );
}

// Renders **bold** and custom emoji like Discord does; everything else is shown as plain text.
export function renderMarkdown(text) {
  return (text || '').split(/(\*\*[^*]+\*\*|<a?:\w+:\d+>)/g).map((part, i) => {
    if (CUSTOM_EMOJI.test(part)) return <Emoji key={i} value={part} />;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/** Discord-style preview: message text, a grid of gray buttons, and the private reply. */
export function DiscordPreview({ content, buttons, disabled, reply }) {
  return (
    <div className="discord">
      <div className="discord-content">{renderMarkdown(content)}</div>
      <div className="discord-buttons">
        {buttons.map((b, i) => (
          <button key={i} type="button" className="discord-button" disabled={disabled}>
            {b.emoji && <Emoji value={b.emoji} />}
            {b.label || 'Button'}
          </button>
        ))}
      </div>
      <p className="discord-reply">
        <span className="muted">Reply after clicking (only they see it):</span> {renderMarkdown(reply)}
      </p>
    </div>
  );
}

export function EnabledSwitch({ checked, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{checked ? 'Enabled' : 'Disabled'}</span>
    </label>
  );
}

export function RoleOptions({ roles }) {
  return roles.map((r) => (
    <option key={r.id} value={r.id} disabled={Boolean(r.problem)}>
      @{r.name}
      {r.problem ? ' (Wrenchy can’t assign this)' : ''}
    </option>
  ));
}

export function SaveBar({ busy, dirty, canSave = true, onDiscard }) {
  return (
    <div className="actions">
      <button type="submit" className="primary" disabled={busy || !dirty || !canSave}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
      {dirty && (
        <button type="button" disabled={busy} onClick={onDiscard}>
          Discard
        </button>
      )}
    </div>
  );
}

export function PanelChannelCard({ editor, onPost }) {
  const { guild, channelId, setChannelId, panelUrl, busy, dirty } = editor;
  return (
    <section className="card">
      <h2>Panel channel</h2>
      <p className="muted">Wrenchy posts the panel here. Posting again removes the old one.</p>
      <div className="row">
        <select className="grow" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">Select a channel…</option>
          {guild.channels.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.canPost}>
              #{c.name}
              {c.category ? ` (${c.category})` : ''}
              {c.canPost ? '' : ' (no permission)'}
            </option>
          ))}
        </select>
        <button type="button" className="primary" disabled={busy || !channelId} onClick={onPost}>
          {panelUrl ? 'Re-post panel' : 'Post panel'}
        </button>
      </div>
      {dirty && <small className="muted">Your unsaved changes will be saved first.</small>}
    </section>
  );
}

export function Notice({ notice }) {
  return notice ? <div className={`notice ${notice.type}`}>{notice.text}</div> : null;
}

export function Loading() {
  return (
    <section className="card">
      <p className="muted">Loading server…</p>
    </section>
  );
}
