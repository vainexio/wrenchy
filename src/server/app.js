import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { VerificationLog } from '../models/Verification.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp(discordClient) {
  const app = express();

  // Render health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, bot: discordClient.isReady(), db: mongoose.connection.readyState === 1 });
  });

  app.get('/api/status', async (_req, res) => {
    const ready = discordClient.isReady();
    const counts = await VerificationLog.aggregate([{ $group: { _id: '$guildId', count: { $sum: 1 } } }]).catch(() => []);
    const countByGuild = Object.fromEntries(counts.map((c) => [c._id, c.count]));

    res.json({
      bot: ready
        ? {
            tag: discordClient.user.tag,
            avatar: discordClient.user.displayAvatarURL({ size: 128 }),
            ping: discordClient.ws.ping,
            uptime: discordClient.uptime,
          }
        : null,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      guilds: ready
        ? discordClient.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 64 }),
            memberCount: g.memberCount,
            verified: countByGuild[g.id] ?? 0,
          }))
        : [],
      totalVerified: counts.reduce((sum, c) => sum + c.count, 0),
    });
  });

  // React dashboard (built with `npm run build`)
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('Wrenchy is running. Run `npm run build` to enable the dashboard.'));
  }

  return app;
}
