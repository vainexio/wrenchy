import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, AuthError } from './api.js';
import AnnouncementEditor from './AnnouncementEditor.jsx';
import { AppContext } from './appContext.js';
import ReactionRolesEditor from './ReactionRolesEditor.jsx';
import RobloxEditor from './RobloxEditor.jsx';
import TeamEditor from './TeamEditor.jsx';
import { Button, ConfirmProvider, Icon, Notice, PageSkeleton, ToastProvider, useConfirm } from './ui.jsx';
import VerificationEditor from './VerificationEditor.jsx';

const TABS = [
  { id: 'team', label: 'Team', icon: 'users', Editor: TeamEditor },
  { id: 'verification', label: 'Verification', icon: 'shield', Editor: VerificationEditor },
  { id: 'reactionRoles', label: 'Reaction Roles', icon: 'tag', Editor: ReactionRolesEditor },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone', Editor: AnnouncementEditor },
  { id: 'roblox', label: 'Roblox Link', icon: 'link', Editor: RobloxEditor },
];
const TAB_KEY = 'wrenchy:tab';

const LOGIN_ERRORS = {
  forbidden: "You don't have the role needed to use this dashboard.",
  not_configured: 'Discord login is not set up on the server yet (DISCORD_CLIENT_SECRET is missing).',
  invalid_state: 'Login expired. Please try again.',
  oauth_failed: 'Discord login failed. Please try again.',
};

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function readLoginError() {
  const code = new URLSearchParams(window.location.search).get('error');
  if (code) window.history.replaceState(null, '', window.location.pathname);
  return code ? (LOGIN_ERRORS[code] ?? 'Login failed.') : null;
}

function readTab() {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? saved : TABS[0].id;
  } catch {
    return TABS[0].id;
  }
}

function BotBadge({ bot, statusError, status }) {
  return (
    <div className="brand">
      {bot?.avatar ? <img src={bot.avatar} alt="" /> : <span className="brand-icon">🔧</span>}
      <div className="grow">
        <div className="brand-name">{bot?.tag?.split('#')[0] ?? 'Wrenchy'}</div>
        <div className="brand-status">
          <span className={`status-dot ${bot ? 'ok' : 'bad'}`} />
          {statusError ?? (bot ? 'Online' : status ? 'Bot offline' : 'Connecting…')}
        </div>
      </div>
    </div>
  );
}

function Login({ bot, status, statusError, error }) {
  return (
    <main className="login-page">
      <section className="card login-card">
        {bot?.avatar ? <img className="brand-logo" src={bot.avatar} alt="" /> : <span className="brand-logo">🔧</span>}
        <div>
          <h1>{bot?.tag?.split('#')[0] ?? 'Wrenchy'} dashboard</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            For Piyesa staff. Log in with Discord; only members with the dashboard role get in.
          </p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <a className="btn discord" href="/api/auth/login">
          Log in with Discord
        </a>
        <span className="subtle">
          <span className={`status-dot ${bot ? 'ok' : 'bad'}`} /> {statusError ?? (bot ? 'Bot online' : status ? 'Bot offline' : 'Connecting…')}
        </span>
      </section>
    </main>
  );
}

function Dashboard({ status, statusError, user, setUser, setLoginError }) {
  const confirm = useConfirm();
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState(null);
  const [tab, setTab] = useState(readTab);
  const [nudge, setNudge] = useState(0);
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const report = useCallback((d) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);
  const bot = status?.bot;

  useEffect(() => {
    api('/guilds')
      .then((list) => {
        setGuilds(list);
        setGuildId(list[0]?.id ?? null);
      })
      .catch(handleError);
  }, []);

  // (closing or reloading the page with unsaved changes: the browser asks)
  useEffect(() => {
    const onLeave = (e) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  function handleError(err) {
    if (err instanceof AuthError) {
      setUser(null);
      setLoginError(err.message);
    }
  }

  /** Runs go() now, or after asking when there are unsaved changes (and shakes the save bar if they stay). */
  async function leaveTab(go) {
    if (dirtyRef.current) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        text: 'You changed things on this tab without saving. Leaving now throws those changes away.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!ok) {
        setNudge((n) => n + 1);
        return;
      }
      report(false);
    }
    go();
  }

  const pickTab = (id) =>
    leaveTab(() => {
      setTab(id);
      try {
        localStorage.setItem(TAB_KEY, id);
      } catch {
        // (remembering the tab is a convenience)
      }
      window.scrollTo({ top: 0 });
    });

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const context = useMemo(() => ({ bot, report, nudge }), [bot, report, nudge]);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const guild = guilds.find((g) => g.id === guildId);

  return (
    <AppContext.Provider value={context}>
      <div className="shell">
        <aside className="sidebar">
          <BotBadge bot={bot} status={status} statusError={statusError} />
          {guilds.length > 0 && (
            <div className="server-switch">
              <label htmlFor="server">Server</label>
              {guilds.length > 1 ? (
                <select id="server" value={guildId ?? ''} onChange={(e) => leaveTab(() => setGuildId(e.target.value))}>
                  {guilds.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="server-one">
                  {guild?.icon ? <img src={guild.icon} alt="" /> : <span className="guild-icon">{guild?.name[0]}</span>}
                  {guild?.name}
                </div>
              )}
            </div>
          )}
          <nav className="nav" aria-label="Dashboard sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`nav-item${t.id === current.id ? ' active' : ''}`}
                aria-current={t.id === current.id ? 'page' : undefined}
                onClick={() => t.id !== current.id && pickTab(t.id)}
              >
                <Icon name={t.icon} />
                {t.label}
                {t.id === current.id && dirty && <span className="nav-dot" title="Unsaved changes" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            {status && (
              <div className="vitals">
                <div className="vital">
                  <b>{status.totalVerified.toLocaleString()}</b>
                  <span>Verified</span>
                </div>
                <div className="vital">
                  <b>{bot ? `${bot.ping}ms` : '—'}</b>
                  <span>Ping</span>
                </div>
                <div className="vital">
                  <b>{bot ? formatUptime(bot.uptime) : '—'}</b>
                  <span>Uptime</span>
                </div>
                <div className="vital">
                  <b>{status.database === 'connected' ? 'OK' : 'Down'}</b>
                  <span>Database</span>
                </div>
              </div>
            )}
            <div className="me">
              <img src={user.avatar} alt="" />
              <span className="me-name grow">{user.name}</span>
              <Button variant="ghost" size="sm" icon="logout" title="Log out" onClick={() => leaveTab(logout)} />
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="content">
            {guildId ? (
              <current.Editor key={`${guildId}-${current.id}`} guildId={guildId} onError={handleError} />
            ) : guilds.length === 0 && status ? (
              <Notice>Wrenchy isn’t in any servers yet. Invite it with the link in the bot’s console.</Notice>
            ) : (
              <PageSkeleton />
            )}
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [loginError, setLoginError] = useState(readLoginError);

  useEffect(() => {
    const load = () =>
      fetch('/api/status')
        .then((r) => r.json())
        .then((data) => {
          setStatus(data);
          setStatusError(null);
        })
        .catch(() => setStatusError('Can’t reach the bot server'));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch((err) => {
        setUser(null);
        if (!(err instanceof AuthError)) setLoginError(err.message);
      });
  }, []);

  return (
    <ToastProvider>
      <ConfirmProvider>
        {user === undefined ? (
          <main className="login-page">
            <div className="spinner" style={{ width: 28, height: 28, color: 'var(--accent)' }} aria-label="Loading" />
          </main>
        ) : user === null ? (
          <Login bot={status?.bot} status={status} statusError={statusError} error={loginError} />
        ) : (
          <Dashboard status={status} statusError={statusError} user={user} setUser={setUser} setLoginError={setLoginError} />
        )}
      </ConfirmProvider>
    </ToastProvider>
  );
}
