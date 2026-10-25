import { createContext, useContext, useEffect } from 'react';

// What every tab can use from the app: the bot (its name and avatar, for the Discord previews), and unsaved changes
// across tabs: a tab reports whether it has any (useReportDirty), so the app can ask before switching tabs, servers or
// leaving the page, and shake the save bar (nudge) instead of losing them.
export const AppContext = createContext({ bot: null, report: () => {}, nudge: 0 });

export const useBot = () => useContext(AppContext).bot;

/** Tells the app whether this tab has unsaved changes; returns the nudge counter for its SaveBar. */
export function useReportDirty(dirty) {
  const { report, nudge } = useContext(AppContext);
  useEffect(() => {
    report(dirty);
  }, [dirty]);
  useEffect(() => () => report(false), []);
  return nudge;
}
