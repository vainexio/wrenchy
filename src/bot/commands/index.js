import * as inactive from './inactive.js';
import * as ping from './ping.js';
import * as update from './update.js';
import * as updateall from './updateall.js';

// Add new slash commands here.
const modules = [ping, inactive, update, updateall];

export const commands = new Map(modules.map((m) => [m.data.name, m]));
export const commandData = modules.map((m) => m.data.toJSON());
