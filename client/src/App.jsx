import { useEffect, useState } from 'react';
import { api, AuthError } from './api.js';
import AnnouncementEditor from './AnnouncementEditor.jsx';
import ReactionRolesEditor from './ReactionRolesEditor.jsx';
import RobloxEditor from './RobloxEditor.jsx';
import TeamEditor from './TeamEditor.jsx';
import VerificationEditor from './VerificationEditor.jsx';

const TABS = [
  { id: 'verification', label: 'Verification', Editor: VerificationEditor },
  { id: 'reactionRoles', label: 'Reaction Roles', Editor: ReactionRolesEditor },
  { id: 'announcements', label: 'Announcements', Editor: AnnouncementEditor },
  { id: 'roblox', label: 'Roblox Link', Editor: RobloxEditor },
  { id: 'team', label: 'Team', Editor: TeamEditor },
];

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

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function readLoginError() {
  const code = new URLSearchParams(window.location.search).get('error');
  if (code) window.history.replaceState(null, '', window.location.pathname);
  return code ? (LOGIN_ERRORS[code] ?? 'Login failed.') : null;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out
  const [loginError, setLoginError] = useState(readLoginError);
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState(null);
  const [tab, setTab] = useState(TABS[0].id);

  useEffect(() => {
    const load = () =>
      fetch('/api/status')
        .then((r) => r.json())
        .then((data) => {
          setStatus(data);
          setStatusError(null);
        })
        .catch(() => setStatusError('Could not reach the bot server.'));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api('/auth/me')
      .then(async (me) => {
        const list = await api('/guilds');
        setGuilds(list);
        setGuildId(list[0]?.id ?? null);
        setUser(me);
      })
      .catch((err) => {
        setUser(null);
        if (!(err instanceof AuthError)) setLoginError(err.message);
      });
  }, []);

  const handleError = (err) => {
    if (err instanceof AuthError) {
      setUser(null);
      setLoginError(err.message);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const bot = status?.bot;

  return (
    <main className="page">
      <header className="header">
        {bot?.avatar ? <img className="avatar" src={bot.avatar} alt="" /> : <div className="avatar">🔧</div>}
        <div className="grow">
          <h1>{bot?.tag ?? 'Wrenchy'}</h1>
          <p className="subtitle">
            <span className={`dot ${bot ? 'online' : 'offline'}`} />
            {statusError ?? (bot ? 'Online' : status ? 'Bot offline' : 'Loading…')}
          </p>
        </div>
        {user && (
          <div className="user">
            <img src={user.avatar} alt="" />
            <span>{user.name}</span>
            <button type="button" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </header>

      {status && (
        <section className="stats">
          <Stat label="Servers" value={status.guilds.length} />
          <Stat label="Verified members" value={status.totalVerified} />
          <Stat label="Gateway ping" value={bot ? `${bot.ping}ms` : '—'} />
          <Stat label="Uptime" value={bot ? formatUptime(bot.uptime) : '—'} />
        </section>
      )}

      {user === null && (
        <section className="card login">
          <h2>Staff login</h2>
          <p className="muted">Log in with Discord to manage Wrenchy. Only staff with the dashboard role can get in.</p>
          {loginError && <div className="notice error">{loginError}</div>}
          <a className="button discord-login" href="/api/auth/login">
            Log in with Discord
          </a>
        </section>
      )}

      {user && (
        <>
          {guilds.length > 1 && (
            <div className="guild-tabs">
              {guilds.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={g.id === guildId ? 'active' : ''}
                  onClick={() => setGuildId(g.id)}
                >
                  {g.icon ? <img src={g.icon} alt="" /> : <span className="guild-icon">{g.name[0]}</span>}
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {guilds.length === 1 && <h2 className="guild-title">{guilds[0].name}</h2>}
          {guildId ? (
            <>
              <nav className="tabs">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={t.id === tab ? 'active' : ''}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              {TABS.filter((t) => t.id === tab).map(({ id, Editor }) => (
                <Editor key={`${guildId}-${id}`} guildId={guildId} onError={handleError} />
              ))}
            </>
          ) : (
            <p className="muted">Wrenchy isn't in any servers yet.</p>
          )}
        </>
      )}

      {status && <p className="muted footer">Database: {status.database}</p>}
    </main>
  );
}
