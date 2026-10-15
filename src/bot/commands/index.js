import * as ping from './ping.js';
import * as verification from './verification.js';

// Add new slash commands here.
const modules = [ping, verification];

export const commands = new Map(modules.map((m) => [m.data.name, m]));
export const commandData = modules.map((m) => m.data.toJSON());
