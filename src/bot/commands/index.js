import * as ping from './ping.js';

// Add new slash commands here.
const modules = [ping];

export const commands = new Map(modules.map((m) => [m.data.name, m]));
export const commandData = modules.map((m) => m.data.toJSON());
