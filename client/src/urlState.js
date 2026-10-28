import { useCallback, useState } from 'react';

// The open tab and each list's search, filters and sort live in the page address (?tab=team&status=inactive&q=bea),
// so a refresh, a bookmark or a link sent to someone shows the same list. Defaults stay out of the
// address; a list (array) default is written comma-separated.

function read(defaults) {
  const params = new URLSearchParams(window.location.search);
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    const raw = params.get(key);
    if (raw === null) out[key] = def;
    else out[key] = Array.isArray(def) ? raw.split(',').filter(Boolean) : raw;
  }
  return out;
}

function write(state, defaults) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, def] of Object.entries(defaults)) {
    const value = state[key];
    const isDefault = Array.isArray(def) ? !value.length : value === def;
    if (isDefault) params.delete(key);
    else params.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  const qs = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

/** [state, set(changes), reset()]: like useState for an object of strings and string lists, kept in the address. */
export function useUrlState(defaults) {
  const [state, setState] = useState(() => read(defaults));
  const set = useCallback(
    (changes) =>
      setState((current) => {
        const next = { ...current, ...(typeof changes === 'function' ? changes(current) : changes) };
        write(next, defaults);
        return next;
      }),
    [],
  );
  const reset = useCallback(() => set(defaults), [set]);
  return [state, set, reset];
}

/** Only `keep` stays in the address (switching tabs drops the last tab's filters). */
export function clearParams(keep = {}) {
  const params = new URLSearchParams(keep);
  const qs = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}
