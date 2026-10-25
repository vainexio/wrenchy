import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useReportDirty } from './appContext.js';
import { useToast } from './ui.jsx';

/**
 * Shared state for a panel editor: loads the server, keeps an editable form derived from it, tracks unsaved changes
 * (and tells the app about them), and runs save / post with a toast for how it went.
 * `kind` is the GuildConfig key ('verification' | 'reactionRoles' | 'roblox').
 */
export function useGuildEditor({ guildId, kind, toForm, onError }) {
  const toast = useToast();
  const [guild, setGuild] = useState(null);
  const [form, setForm] = useState(null);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (data) => {
    setGuild(data);
    setForm(toForm(data));
    setChannelId((current) => data[kind].channelId ?? current);
  };

  useEffect(() => {
    setGuild(null);
    api(`/guilds/${guildId}`).then(load).catch(onError);
  }, [guildId]);

  const saved = useMemo(() => guild && toForm(guild), [guild]);
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));
  const nudge = useReportDirty(dirty);

  async function run(action, success) {
    setBusy(true);
    try {
      const data = await action();
      load(data);
      toast(typeof success === 'function' ? success(data) : success);
      return true;
    } catch (err) {
      onError(err);
      toast({ tone: 'error', title: 'That didn’t work', text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const path = kind === 'reactionRoles' ? 'reaction-roles' : kind;
  const save = (body) => api(`/guilds/${guildId}/${path}`, { method: 'PUT', body });
  const post = () => api(`/guilds/${guildId}/${path}/panel`, { method: 'POST', body: { channelId } });
  const panelUrl = guild?.panelUrls[kind] ?? null;
  const viewLink = (data) => {
    const url = data.panelUrls[kind];
    return url ? { href: url, label: 'View in Discord' } : undefined;
  };

  return {
    guild, form, setForm, saved, dirty, busy, nudge, channelId, setChannelId, panelUrl, kind,
    discard: () => setForm(saved),
    onSave: (body) =>
      run(() => save(body), (data) => ({
        title: 'Saved',
        text: data.panelUrls[kind] ? 'The panel in Discord was updated too.' : undefined,
        link: viewLink(data),
      })),
    onPost: (body) =>
      run(async () => {
        if (dirty) await save(body);
        return post();
      }, (data) => ({ title: 'Posted in Discord', link: viewLink(data) })),
  };
}
