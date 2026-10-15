import {
  DiscordPreview,
  EnabledSwitch,
  Loading,
  Notice,
  PanelChannelCard,
  RoleOptions,
  SaveBar,
} from './PanelParts.jsx';
import { useGuildEditor } from './useGuildEditor.js';

const NEW_ROLE = '__new__';
const MAX_BUTTONS = 25;

function toForm(guild) {
  const rr = guild.reactionRoles;
  return {
    enabled: rr.enabled,
    content: rr.content,
    addedMessage: rr.addedMessage,
    removedMessage: rr.removedMessage,
    buttons: rr.buttons.map((b) => ({ roleId: b.roleId, label: b.label, emoji: b.emoji ?? '' })),
  };
}

export default function ReactionRolesEditor({ guildId, onError }) {
  const editor = useGuildEditor({ guildId, kind: 'reactionRoles', toForm, onError });
  const { guild, form, setForm, saved, dirty, busy, notice, panelUrl } = editor;
  if (!guild || !form) return <Loading />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setButton = (index, changes) =>
    setForm({ ...form, buttons: form.buttons.map((b, i) => (i === index ? { ...b, ...changes } : b)) });
  const removeButton = (index) => setForm({ ...form, buttons: form.buttons.filter((_, i) => i !== index) });
  const moveButton = (index, delta) => {
    const buttons = [...form.buttons];
    [buttons[index], buttons[index + delta]] = [buttons[index + delta], buttons[index]];
    setForm({ ...form, buttons });
  };
  const addButton = () => setForm({ ...form, buttons: [...form.buttons, { roleId: NEW_ROLE, label: '', emoji: '' }] });

  // When a role is picked, default the label to the role name if it's still empty.
  const pickRole = (index, roleId) => {
    const role = guild.roles.find((r) => r.id === roleId);
    const current = form.buttons[index];
    setButton(index, { roleId, label: current.label || role?.name || '' });
  };

  const roleName = (b) => (b.roleId === NEW_ROLE ? b.label : guild.roles.find((r) => r.id === b.roleId)?.name);
  const sampleRole = form.buttons[0] ? `@${roleName(form.buttons[0]) || 'Role'}` : '@Role';
  const usedRoleIds = form.buttons.map((b) => b.roleId).filter((id) => id !== NEW_ROLE);
  const hasDuplicates = new Set(usedRoleIds).size !== usedRoleIds.length;

  return (
    <form className="editor" onSubmit={(e) => editor.onSave(form, e)}>
      <section className="card">
        <div className="card-head">
          <h2>Reaction Roles</h2>
          <EnabledSwitch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
        </div>
        <p className="muted">
          Members click a button to get the role, and click again to remove it.
          {panelUrl && (
            <>
              {' '}
              <a href={panelUrl} target="_blank" rel="noreferrer">
                View panel in Discord
              </a>
            </>
          )}
        </p>

        <div className="split">
          <div className="fields">
            <label className="field">
              <span>Message</span>
              <textarea rows={5} value={form.content} maxLength={2000} onChange={set('content')} required />
              <small className="muted">Supports Discord formatting like **bold**, *italic*, and # headings.</small>
            </label>
            <div className="row">
              <label className="field grow">
                <span>Reply when added</span>
                <input value={form.addedMessage} maxLength={500} onChange={set('addedMessage')} required />
              </label>
              <label className="field grow">
                <span>Reply when removed</span>
                <input value={form.removedMessage} maxLength={500} onChange={set('removedMessage')} required />
              </label>
            </div>
            <small className="muted">
              Use <code>{'{role}'}</code> where the role name should go.
            </small>
          </div>
          <div className="preview">
            <span className="field-label">Preview</span>
            <DiscordPreview
              content={form.content}
              buttons={form.buttons}
              disabled={!form.enabled}
              reply={form.addedMessage.replaceAll('{role}', `**${sampleRole}**`)}
            />
          </div>
        </div>

        <div className="field">
          <span>
            Buttons ({form.buttons.length}/{MAX_BUTTONS})
          </span>
          <div className="role-buttons">
            {form.buttons.map((b, i) => (
              <div className="role-button" key={i}>
                <select value={b.roleId} onChange={(e) => pickRole(i, e.target.value)} aria-label="Role">
                  <option value={NEW_ROLE}>+ Create new role (named after the label)</option>
                  <RoleOptions roles={guild.roles} />
                </select>
                <input
                  value={b.label}
                  maxLength={80}
                  placeholder="Label"
                  onChange={(e) => setButton(i, { label: e.target.value })}
                  required
                  aria-label="Button label"
                />
                <input
                  className="emoji-input"
                  value={b.emoji}
                  maxLength={64}
                  placeholder="Emoji"
                  onChange={(e) => setButton(i, { emoji: e.target.value })}
                  aria-label="Button emoji"
                />
                <div className="role-button-tools">
                  <button type="button" title="Move up" disabled={i === 0} onClick={() => moveButton(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={i === form.buttons.length - 1}
                    onClick={() => moveButton(i, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" title="Remove" onClick={() => removeButton(i)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          {hasDuplicates && <small className="error-text">Each role can only be on one button.</small>}
          <div>
            <button type="button" onClick={addButton} disabled={form.buttons.length >= MAX_BUTTONS}>
              + Add button
            </button>
          </div>
        </div>

        <SaveBar busy={busy} dirty={dirty} canSave={!hasDuplicates} onDiscard={() => setForm(saved)} />
      </section>

      <PanelChannelCard editor={editor} onPost={() => editor.onPost(form)} />
      <Notice notice={notice} />
    </form>
  );
}
