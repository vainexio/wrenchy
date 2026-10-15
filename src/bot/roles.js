import { config } from '../config.js';

/** Returns an error string if the bot can't assign `role`, otherwise null. */
export function checkAssignable(guild, role) {
  if (role.id === guild.id) return 'You cannot use @everyone as the verified role.';
  if (role.managed) return `${role} is managed by an integration and can't be assigned.`;
  const me = guild.members.me;
  if (!me.permissions.has('ManageRoles')) return 'I need the **Manage Roles** permission.';
  if (role.position >= me.roles.highest.position) {
    return `${role} is above (or equal to) my highest role. Drag my role above it in Server Settings → Roles.`;
  }
  return null;
}

/** Finds the default verified role by name, creating it if it doesn't exist. */
export async function findOrCreateDefaultRole(guild) {
  await guild.roles.fetch();
  const existing = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === config.defaultRoleName.toLowerCase(),
  );
  if (existing) return existing;
  return guild.roles.create({
    name: config.defaultRoleName,
    reason: 'Wrenchy verification role',
  });
}
