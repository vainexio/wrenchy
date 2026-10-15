import { useEffect, useState } from 'react';

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

export default function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/status')
        .then((r) => r.json())
        .then((data) => {
          setStatus(data);
          setError(null);
        })
        .catch(() => setError('Could not reach the bot server.'));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const bot = status?.bot;

  return (
    <main className="page">
      <header className="header">
        {bot?.avatar ? <img className="avatar" src={bot.avatar} alt="" /> : <div className="avatar">🔧</div>}
        <div>
          <h1>{bot?.tag ?? 'Wrenchy'}</h1>
          <p className="subtitle">
            <span className={`dot ${bot ? 'online' : 'offline'}`} />
            {error ?? (bot ? 'Online' : status ? 'Bot offline' : 'Loading…')}
          </p>
        </div>
      </header>

      {status && (
        <>
          <section className="stats">
            <Stat label="Servers" value={status.guilds.length} />
            <Stat label="Verified members" value={status.totalVerified} />
            <Stat label="Gateway ping" value={bot ? `${bot.ping}ms` : '—'} />
            <Stat label="Uptime" value={bot ? formatUptime(bot.uptime) : '—'} />
          </section>

          <section className="card">
            <h2>Servers</h2>
            {status.guilds.length === 0 && <p className="muted">Not in any servers yet.</p>}
            <ul className="guilds">
              {status.guilds.map((g) => (
                <li key={g.id}>
                  {g.icon ? <img src={g.icon} alt="" /> : <div className="guild-icon">{g.name[0]}</div>}
                  <span className="guild-name">{g.name}</span>
                  <span className="muted">
                    {g.verified} verified · {g.memberCount} members
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className="muted footer">
            Database: {status.database} · Configure verification in Discord with <code>/verification</code>
          </p>
        </>
      )}
    </main>
  );
}
