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

const CREATE_ROLE = '__create__';
const FIELDS = ['enabled', 'content', 'buttonLabel', 'buttonEmoji', 'successMessage', 'roleId'];

function toForm(guild) {
  const v = guild.verification;
  const defaultRole = guild.roles.find((r) => r.name.toLowerCase() === guild.defaultRoleName.toLowerCase());
  return {
    ...Object.fromEntries(FIELDS.map((k) => [k, v[k] ?? ''])),
    roleId: v.roleId ?? (defaultRole ? defaultRole.id : CREATE_ROLE),
  };
}

export default function VerificationEditor({ guildId, onError }) {
  const editor = useGuildEditor({ guildId, kind: 'verification', toForm, onError });
  const { guild, form, setForm, saved, dirty, busy, notice, panelUrl } = editor;
  if (!guild || !form) return <Loading />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form className="editor" onSubmit={(e) => editor.onSave(form, e)}>
      <section className="card">
        <div className="card-head">
          <h2>Verification</h2>
          <EnabledSwitch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
        </div>
        <p className="muted">
          {guild.verifiedCount} member{guild.verifiedCount === 1 ? '' : 's'} verified
          {panelUrl && (
            <>
              {' · '}
              <a href={panelUrl} target="_blank" rel="noreferrer">
                View panel in Discord
              </a>
            </>
          )}
        </p>

        <label className="field">
          <span>Role to give</span>
          <select value={form.roleId} onChange={set('roleId')}>
            {!guild.defaultRoleExists && (
              <option value={CREATE_ROLE}>+ Create “{guild.defaultRoleName}” role</option>
            )}
            <RoleOptions roles={guild.roles} />
          </select>
          {form.roleId === CREATE_ROLE && <small className="muted">The role will be created when you save.</small>}
        </label>

        <div className="split">
          <div className="fields">
            <label className="field">
              <span>Message</span>
              <textarea rows={6} value={form.content} maxLength={2000} onChange={set('content')} required />
              <small className="muted">Supports Discord formatting like **bold**, *italic*, and # headings.</small>
            </label>
            <div className="row">
              <label className="field grow">
                <span>Button label</span>
                <input value={form.buttonLabel} maxLength={80} onChange={set('buttonLabel')} required />
              </label>
              <label className="field small">
                <span>Emoji</span>
                <input value={form.buttonEmoji} maxLength={64} onChange={set('buttonEmoji')} placeholder="none" />
              </label>
            </div>
            <label className="field">
              <span>Message after verifying</span>
              <textarea
                rows={2}
                value={form.successMessage}
                maxLength={2000}
                onChange={set('successMessage')}
                required
              />
            </label>
          </div>
          <div className="preview">
            <span className="field-label">Preview</span>
            <DiscordPreview
              content={form.content}
              buttons={[{ label: form.buttonLabel, emoji: form.buttonEmoji }]}
              disabled={!form.enabled}
              reply={form.successMessage}
            />
          </div>
        </div>

        <SaveBar busy={busy} dirty={dirty} onDiscard={() => setForm(saved)} />
      </section>

      <PanelChannelCard editor={editor} onPost={() => editor.onPost(form)} />
      <Notice notice={notice} />
    </form>
  );
}
