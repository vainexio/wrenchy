// A ticket channel's name from its type's pattern (shared by the bot and the dashboard's preview, so they always
// agree): {n} is the ticket's number, 4 digits ("cc-apps-{n}" -> "cc-apps-0001"); {user} is the opener's username.
// Discord channel names are lowercase, no spaces, at most 100 characters.

export const DEFAULT_PATTERN = 'ticket-{n}';

/** "Player Report" -> "player-report" */
export function slug(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export function ticketName(pattern, number, username = '') {
  const filled = String(pattern || DEFAULT_PATTERN)
    .replaceAll('{n}', String(number).padStart(4, '0'))
    .replaceAll('{user}', username);
  return slug(filled).slice(0, 100) || `ticket-${String(number).padStart(4, '0')}`;
}
