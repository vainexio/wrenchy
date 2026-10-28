import { useBot } from './appContext.js';
import { DiscordPreview, PanelChannelCard, RoleChips, RoleOptions } from './PanelParts.jsx';
import { Badge, Card, Field, PageHead, PageSkeleton, SaveBar, Toggle } from './ui.jsx';
import { useGuildEditor } from './useGuildEditor.js';

const CREATE_ROLE = '__create__';
const FIELDS = ['enabled', 'content', 'buttonLabel', 'buttonEmoji', 'successMessage', 'roleId'];

function toForm(guild) {
  const v = guild.verification;
  const defaultRole = guild.roles.find((r) => r.name.toLowerCase() === guild.defaultRoleName.toLowerCase());
  return {
    ...Object.fromEntries(FIELDS.map((k) => [k, v[k] ?? ''])),
    roleId: v.roleId ?? (defaultRole ? defaultRole.id : CREATE_ROLE),
    extraRoleIds: [...(v.extraRoleIds ?? [])],
  };
}

export default function VerificationEditor({ guildId, onError }) {
  const bot = useBot();
  const editor = useGuildEditor({ guildId, kind: 'verification', toForm, onError });
  const { guild, form, setForm, dirty, busy, nudge } = editor;
  if (!guild || !form) return <PageSkeleton />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const blocked = !form.content.trim() ? 'The message can’t be empty' : !form.buttonLabel.trim() ? 'The button needs a label' : null;

  return (
    <>
      <PageHead
        title="Verification"
        description="New members press a button to get the main role and unlock the server."
      >
        <Badge>{guild.verifiedCount.toLocaleString()} verified</Badge>
        <Toggle
          checked={form.enabled}
          onChange={(enabled) => setForm({ ...form, enabled })}
          label={form.enabled ? 'On' : 'Off'}
        />
      </PageHead>

      <div className="stack">
        <Card title="Roles" description="What someone gets when they press the button.">
          <Field
            label="Main role"
            hint={form.roleId === CREATE_ROLE ? 'The role is created when you save.' : 'Having this role means they’re verified.'}
          >
            <select value={form.roleId} onChange={set('roleId')}>
              {!guild.defaultRoleExists && <option value={CREATE_ROLE}>+ Create “{guild.defaultRoleName}” role</option>}
              <RoleOptions roles={guild.roles} />
            </select>
          </Field>
          <Field
            label="Extra roles"
            hint="Given at the same time. Members can remove them later."
          >
            <RoleChips
              roles={guild.roles}
              value={form.extraRoleIds}
              exclude={[form.roleId]}
              onChange={(extraRoleIds) => setForm({ ...form, extraRoleIds })}
            />
          </Field>
        </Card>

        <Card title="Panel message" description="What members see in the verification channel, and the reply after they verify.">
          <div className="split">
            <div>
              <Field label="Message" max={2000} value={form.content} hint="Discord formatting works: **bold**, *italic*, # headings.">
                <textarea rows={6} value={form.content} maxLength={2000} onChange={set('content')} className={!form.content.trim() ? 'invalid' : ''} />
              </Field>
              <div className="row">
                <Field label="Button label" className="grow" max={80} value={form.buttonLabel}>
                  <input value={form.buttonLabel} maxLength={80} onChange={set('buttonLabel')} className={!form.buttonLabel.trim() ? 'invalid' : ''} />
                </Field>
                <Field label="Emoji" className="small">
                  <input value={form.buttonEmoji} maxLength={64} onChange={set('buttonEmoji')} placeholder="none" />
                </Field>
              </div>
              <Field label="Reply after verifying" max={2000} value={form.successMessage} hint="Only the member who verified sees it.">
                <textarea rows={2} value={form.successMessage} maxLength={2000} onChange={set('successMessage')} />
              </Field>
            </div>
            <DiscordPreview
              bot={bot}
              content={form.content}
              buttons={[{ label: form.buttonLabel, emoji: form.buttonEmoji }]}
              disabled={!form.enabled}
              reply={form.successMessage}
            />
          </div>
        </Card>

        <PanelChannelCard editor={editor} onPost={() => editor.onPost(form)} />
      </div>

      <SaveBar dirty={dirty} busy={busy} blocked={blocked} nudge={nudge} onSave={() => editor.onSave(form)} onDiscard={editor.discard} />
    </>
  );
}
