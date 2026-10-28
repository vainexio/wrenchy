// Name search shared by the server (member search) and the dashboard (role pickers, list filters): how well a query
// matches a thing's names, so exact names come first, then names that start with it, then names with a word that
// starts with it, then names that merely contain it. Plain JS, no imports: the dashboard imports it too.

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const WORD_START = /[\s(@|_\-.[\]/:]/;

/** How one query word matches one name: 0 exact, 1 prefix, 2 a word in it starts with it, 3 contains it; null = no. */
function wordScore(name, word) {
  if (!name) return null;
  if (name === word) return 0;
  if (name.startsWith(word)) return 1;
  let i = name.indexOf(word);
  if (i < 0) return null;
  for (; i >= 0; i = name.indexOf(word, i + 1)) if (WORD_START.test(name[i - 1])) return 2;
  return 3;
}

/**
 * How well `query` matches `names` (a list of strings; empty ones are skipped): a number, lower is better, or null
 * for no match. Every word of the query must match one of the names ("ana tester" finds "Ana" holding "Tester"); a
 * leading @ is ignored, so "@juan" finds the username juan. An empty query matches everything (0).
 */
export function matchScore(names, query) {
  const words = fold(query).replace(/^@/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const folded = names.filter(Boolean).map(fold);
  const whole = words.join(' ');
  if (folded.some((n) => n === whole || n.replace(/^@/, '') === whole)) return -1; // (the whole query is a name)
  let total = 0;
  for (const word of words) {
    let best = null;
    for (const n of folded) {
      const s = wordScore(n, word);
      if (s !== null && (best === null || s < best)) best = s;
    }
    if (best === null) return null;
    total += best;
  }
  return total / words.length;
}

/**
 * The items matching `query`, best first (ties keep their order): `namesOf(item)` gives each item's names.
 * Returns [{ item, score }].
 */
export function rankByName(items, query, namesOf) {
  const out = [];
  items.forEach((item, i) => {
    const score = matchScore(namesOf(item), query);
    if (score !== null) out.push({ item, score, i });
  });
  out.sort((a, b) => a.score - b.score || a.i - b.i);
  return out.map(({ item, score }) => ({ item, score }));
}
