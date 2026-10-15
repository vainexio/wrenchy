import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import PanelPreview from './PanelPreview.jsx';

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
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(null);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = (data) => {
    setGuild(data);
    setForm(toForm(data));
    setChannelId((current) => data.verification.channelId ?? current);
  };

  useEffect(() => {
    setGuild(null);
    setNotice(null);
    api(`/guilds/${guildId}`).then(load).catch(onError);
  }, [guildId]);

  const saved = useMemo(() => guild && toForm(guild), [guild]);
  const dirty = Boolean(form && saved && FIELDS.some((k) => form[k] !== saved[k]));

  if (!guild || !form) {
    return (
      <section className="card">
        <p className="muted">Loading server…</p>
      </section>
    );
  }

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function run(action, successText) {
    setBusy(true);
    setNotice(null);
    try {
      load(await action());
      setNotice({ type: 'ok', text: successText });
    } catch (err) {
      onError(err);
      setNotice({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const save = () => api(`/guilds/${guildId}/verification`, { method: 'PUT', body: form });
  const post = () => api(`/guilds/${guildId}/verification/panel`, { method: 'POST', body: { channelId } });

  const onSave = (e) => {
    e.preventDefault();
    run(save, guild.panelUrl ? 'Saved. The panel in Discord was updated.' : 'Saved.');
  };
  const onPost = () =>
    run(async () => {
      if (dirty) await save();
      return post();
    }, 'Panel posted in Discord.');

  return (
    <form className="editor" onSubmit={onSave}>
      <section className="card">
        <div className="card-head">
          <h2>Verification</h2>
          <label className="switch">
            <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
            <span>{form.enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        <p className="muted">
          {guild.verifiedCount} member{guild.verifiedCount === 1 ? '' : 's'} verified
          {guild.panelUrl && (
            <>
              {' · '}
              <a href={guild.panelUrl} target="_blank" rel="noreferrer">
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
            {guild.roles.map((r) => (
              <option key={r.id} value={r.id} disabled={Boolean(r.problem)}>
                @{r.name}
                {r.problem ? ' (Wrenchy can’t assign this)' : ''}
              </option>
            ))}
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
            <PanelPreview v={form} />
          </div>
        </div>

        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && (
            <button type="button" disabled={busy} onClick={() => setForm(saved)}>
              Discard
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Panel channel</h2>
        <p className="muted">Wrenchy posts the verification button here. Posting again removes the old one.</p>
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
            {guild.panelUrl ? 'Re-post panel' : 'Post panel'}
          </button>
        </div>
        {dirty && <small className="muted">Your unsaved changes will be saved first.</small>}
      </section>

      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}
    </form>
  );
}
