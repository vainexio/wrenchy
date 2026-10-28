// Building blocks shared by the panel editors: the Discord-style preview, role pickers, the panel channel card.
import { useState } from 'react';
import { rankByName } from '../../src/shared/search.js';
import { Badge, Button, Card, Field, Icon, LinkButton, Popover, SearchList } from './ui.jsx';

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

/** Wrenchy's message as Discord shows it: its avatar and name, then what's inside. */
export function DiscordMessage({ bot, children }) {
  return (
    <div className="discord-msg">
      <div className="discord-avatar">{bot?.avatar ? <img src={bot.avatar} alt="" /> : '🔧'}</div>
      <div className="grow">
        <div className="discord-name">
          {bot?.tag?.split('#')[0] ?? 'Wrenchy'} <span className="discord-bot">APP</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A panel as Discord shows it: the message, its buttons, and the private reply someone gets after clicking. */
export function DiscordPreview({ bot, content, buttons, disabled, reply, replyLabel = 'Reply after clicking (only they see it)' }) {
  return (
    <div>
      <div className="preview-label">
        <span>Preview</span>
        {disabled && <Badge tone="warn">Turned off: buttons greyed out</Badge>}
      </div>
      <div className="discord">
        <DiscordMessage bot={bot}>
          <div className="discord-content">{content ? renderMarkdown(content) : <span className="placeholder">Your message…</span>}</div>
          <div className="discord-buttons">
            {buttons.map((b, i) => (
              <button key={i} type="button" className="discord-button" disabled={disabled} tabIndex={-1}>
                {b.emoji && <Emoji value={b.emoji} />}
                {b.label || 'Button'}
              </button>
            ))}
          </div>
        </DiscordMessage>
        {reply && (
          <div className="discord-reply">
            <div className="discord-reply-label">
              <Icon name="info" width="12" height="12" /> {replyLabel}
            </div>
            {renderMarkdown(reply)}
          </div>
        )}
      </div>
    </div>
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

/** Type to find a role (in the order given: Discord's, highest first); the ones Wrenchy can't assign are greyed. */
function RolePicker({ roles, onPick, close }) {
  const [query, setQuery] = useState('');
  const found = rankByName(roles, query, (r) => [r.name, r.id]).map((x) => x.item);
  return (
    <SearchList
      query={query}
      onQuery={setQuery}
      placeholder="Find a role…"
      items={found.map((r) => ({
        key: r.id,
        role: r,
        disabled: Boolean(r.problem),
        content: (
          <div className="pick-row">
            <span className="role-dot" style={{ background: r.color && r.color !== '#000000' ? r.color : undefined }} />
            <span className="grow">
              @{r.name}
              {r.problem && <small>{r.problem}</small>}
            </span>
          </div>
        ),
      }))}
      onPick={(it) => {
        onPick(it.role.id);
        close();
      }}
      empty={`No role called “${query}”`}
    />
  );
}

/** Multi-role picker: selected roles as removable chips, plus a searchable list to add more. */
export function RoleChips({ roles, value, onChange, exclude = [], addLabel = 'Add role…' }) {
  const selected = value.map((id) => roles.find((r) => r.id === id) ?? { id, name: 'deleted role', problem: 'This role no longer exists' });
  const available = roles.filter((r) => !value.includes(r.id) && !exclude.includes(r.id));
  return (
    <div className="chips">
      {selected.map((r) => (
        <span key={r.id} className={`chip${r.problem ? ' chip-bad' : ''}`} title={r.problem ?? ''}>
          @{r.name}
          <button type="button" aria-label={`Remove @${r.name}`} title="Remove" onClick={() => onChange(value.filter((id) => id !== r.id))}>
            ✕
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <Popover
          label={addLabel}
          trigger={(props) => (
            <button type="button" className="chip-add" {...props}>
              + {addLabel.replace(/…$/, '')}
            </button>
          )}
        >
          {(close) => <RolePicker roles={available} onPick={(id) => onChange([...value, id])} close={close} />}
        </Popover>
      )}
      {!selected.length && !available.length && <span className="subtle">No roles to pick</span>}
    </div>
  );
}

/** Where the panel is posted, and the button that posts it. */
export function PanelChannelCard({ editor, onPost, what = 'panel' }) {
  const { guild, channelId, setChannelId, panelUrl, busy, dirty } = editor;
  const [posting, setPosting] = useState(false);
  const current = guild.channels.find((c) => c.id === guild[editor.kind]?.channelId);
  const post = async () => {
    setPosting(true);
    await onPost();
    setPosting(false);
  };
  return (
    <Card
      title="Post in Discord"
      description={`Where Wrenchy posts the ${what}. Posting again replaces the old one.`}
      aside={
        panelUrl ? (
          <Badge tone="ok" dot>
            Posted in #{current?.name ?? 'a channel'}
          </Badge>
        ) : (
          <Badge tone="warn" dot>
            Not posted yet
          </Badge>
        )
      }
    >
      <div className="row">
        <Field label="Channel" className="grow">
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
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
        <Button variant="primary" icon="send" loading={posting} disabled={busy || !channelId} onClick={post}>
          {panelUrl ? 'Re-post' : 'Post'} {what}
        </Button>
        {panelUrl && <LinkButton href={panelUrl}>View</LinkButton>}
      </div>
      {dirty && <p className="hint" style={{ marginBottom: 0 }}>Your unsaved changes are saved first.</p>}
    </Card>
  );
}
