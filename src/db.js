import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDatabase() {
  mongoose.connection.on('error', (err) => console.error('[db] connection error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));

  await mongoose.connect(config.mongoUri);
  console.log(`[db] connected to "${mongoose.connection.name}"`);
}
