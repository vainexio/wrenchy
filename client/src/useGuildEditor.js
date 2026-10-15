import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

/**
 * Shared state for a panel editor: loads the server, keeps an editable form
 * derived from it, tracks unsaved changes, and runs save/post actions.
 * `kind` is the GuildConfig key ('verification' | 'reactionRoles').
 */
export function useGuildEditor({ guildId, kind, toForm, onError }) {
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(null);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = (data) => {
    setGuild(data);
    setForm(toForm(data));
    setChannelId((current) => data[kind].channelId ?? current);
  };

  useEffect(() => {
    setGuild(null);
    setNotice(null);
    api(`/guilds/${guildId}`).then(load).catch(onError);
  }, [guildId]);

  const saved = useMemo(() => guild && toForm(guild), [guild]);
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));

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

  const path = kind === 'reactionRoles' ? 'reaction-roles' : kind;
  const save = (body) => api(`/guilds/${guildId}/${path}`, { method: 'PUT', body });
  const post = () => api(`/guilds/${guildId}/${path}/panel`, { method: 'POST', body: { channelId } });
  const panelUrl = guild?.panelUrls[kind] ?? null;

  return {
    guild, form, setForm, saved, dirty, busy, notice, channelId, setChannelId, panelUrl,
    onSave: (body, e) => {
      e?.preventDefault();
      run(() => save(body), panelUrl ? 'Saved. The panel in Discord was updated.' : 'Saved.');
    },
    onPost: (body) =>
      run(async () => {
        if (dirty) await save(body);
        return post();
      }, 'Panel posted in Discord.'),
  };
}
