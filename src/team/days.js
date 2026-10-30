// Days for the activity charts, in the studio's time zone (Manila): "2026-10-30".

const TIME_ZONE = 'Asia/Manila';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The day a moment falls on: "YYYY-MM-DD". */
export function dayKey(date = new Date()) {
  return fmt.format(date);
}

/** The last `n` days, oldest first, ending today. */
export function lastDays(n, now = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(new Date(now - i * 86_400_000)));
  return [...new Set(out)];
}
