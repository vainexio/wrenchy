import { config } from '../config.js';

/** Returns an error string if the bot can't assign `role`, otherwise null. */
export function checkAssignable(guild, role) {
  if (role.id === guild.id) return 'You cannot use @everyone as the verified role.';
  if (role.managed) return `@${role.name} is managed by an integration and can't be assigned.`;
  const me = guild.members.me;
  if (!me.permissions.has('ManageRoles')) return 'Wrenchy needs the Manage Roles permission.';
  if (role.position >= me.roles.highest.position) {
    return `@${role.name} is above Wrenchy's highest role. Drag the Wrenchy role above it in Server Settings → Roles.`;
  }
  return null;
}

export function findDefaultRole(guild) {
  return guild.roles.cache.find((r) => r.name.toLowerCase() === config.defaultRoleName.toLowerCase());
}

/** Finds the default verified role by name, creating it if it doesn't exist. */
export async function findOrCreateDefaultRole(guild) {
  return (
    findDefaultRole(guild) ??
    guild.roles.create({ name: config.defaultRoleName, reason: 'Wrenchy verification role' })
  );
}
