import { useBot } from './appContext.js';
import { DiscordPreview, PanelChannelCard, RoleOptions } from './PanelParts.jsx';
import { Badge, Button, Card, Empty, Field, PageHead, PageSkeleton, SaveBar, Toggle } from './ui.jsx';
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
  const bot = useBot();
  const editor = useGuildEditor({ guildId, kind: 'reactionRoles', toForm, onError });
  const { guild, form, setForm, dirty, busy, nudge } = editor;
  if (!guild || !form) return <PageSkeleton />;

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
  const duplicates = new Set(usedRoleIds.filter((id, i) => usedRoleIds.indexOf(id) !== i));
  const unlabelled = form.buttons.some((b) => !b.label.trim());
  const blocked = duplicates.size
    ? 'Each role can only be on one button'
    : unlabelled
      ? 'Every button needs a label'
      : !form.content.trim()
        ? 'The message can’t be empty'
        : null;

  return (
    <>
      <PageHead title="Reaction Roles" description="Buttons where members pick their own roles. Click once to add, again to remove.">
        <Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label={form.enabled ? 'On' : 'Off'} />
      </PageHead>

      <div className="stack">
        <Card
          title="Buttons"
          description="One button per role, in the order they show."
          aside={<Badge>{form.buttons.length} / {MAX_BUTTONS}</Badge>}
          footer={
            <Button icon="plus" onClick={addButton} disabled={form.buttons.length >= MAX_BUTTONS}>
              Add button
            </Button>
          }
        >
          {form.buttons.length === 0 ? (
            <Empty icon="tag" title="No buttons yet">
              Add a button for each role members can pick.
            </Empty>
          ) : (
            <div className="rows">
              {form.buttons.map((b, i) => (
                <div className="role-button" key={i}>
                  <select
                    value={b.roleId}
                    onChange={(e) => pickRole(i, e.target.value)}
                    aria-label={`Button ${i + 1} role`}
                    className={duplicates.has(b.roleId) ? 'invalid' : ''}
                  >
                    <option value={NEW_ROLE}>+ New role (named after the label)</option>
                    <RoleOptions roles={guild.roles} />
                  </select>
                  <input
                    value={b.label}
                    maxLength={80}
                    placeholder="Label"
                    onChange={(e) => setButton(i, { label: e.target.value })}
                    aria-label={`Button ${i + 1} label`}
                    className={!b.label.trim() ? 'invalid' : ''}
                  />
                  <input
                    value={b.emoji}
                    maxLength={64}
                    placeholder="Emoji"
                    onChange={(e) => setButton(i, { emoji: e.target.value })}
                    aria-label={`Button ${i + 1} emoji`}
                  />
                  <div className="role-button-tools">
                    <Button size="sm" variant="ghost" icon="up" title="Move up" disabled={i === 0} onClick={() => moveButton(i, -1)} />
                    <Button size="sm" variant="ghost" icon="down" title="Move down" disabled={i === form.buttons.length - 1} onClick={() => moveButton(i, 1)} />
                    <Button size="sm" variant="ghost-danger" icon="trash" title="Remove button" onClick={() => removeButton(i)} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {duplicates.size > 0 && <p className="field-error">The same role is on two buttons. Pick a different role for one of them.</p>}
        </Card>

        <Card title="Panel message" description="The text above the buttons, and the private replies when someone adds or removes a role.">
          <div className="split">
            <div>
              <Field label="Message" max={2000} value={form.content} hint="Discord formatting works: **bold**, *italic*, # headings.">
                <textarea rows={5} value={form.content} maxLength={2000} onChange={set('content')} className={!form.content.trim() ? 'invalid' : ''} />
              </Field>
              <Field label="Reply when a role is added" max={500} value={form.addedMessage} hint={<>Use <code>{'{role}'}</code> where the role goes.</>}>
                <input value={form.addedMessage} maxLength={500} onChange={set('addedMessage')} />
              </Field>
              <Field label="Reply when a role is removed" max={500} value={form.removedMessage}>
                <input value={form.removedMessage} maxLength={500} onChange={set('removedMessage')} />
              </Field>
            </div>
            <DiscordPreview
              bot={bot}
              content={form.content}
              buttons={form.buttons}
              disabled={!form.enabled}
              reply={form.addedMessage.replaceAll('{role}', `**${sampleRole}**`)}
              replyLabel="Reply when they add a role"
            />
          </div>
        </Card>

        <PanelChannelCard editor={editor} onPost={() => editor.onPost(form)} />
      </div>

      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={() => editor.onSave(form)} onDiscard={editor.discard} />
    </>
  );
}
