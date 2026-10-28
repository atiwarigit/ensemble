const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/**
 * Turns "this month", "last month", "october", "oct 2025", "2026-10" into YYYY-MM (UTC).
 * A bare month name means the most recent one that isn't in the future. Returns null if none found.
 */
export function parseMonth(text: string | undefined | null, now = new Date()): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const iso = t.match(/\b(\d{4})-(\d{2})\b/);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${iso[1]}-${iso[2]}`;
  if (/\bthis month\b/.test(t)) return ym(y, m);
  if (/\blast month\b/.test(t)) return m === 1 ? ym(y - 1, 12) : ym(y, m - 1);
  for (let i = 0; i < 12; i++) {
    const name = MONTHS[i];
    const re = new RegExp(`\\b(${name}|${name.slice(0, 3)})\\b(?:\\s+(\\d{4}))?`);
    const hit = t.match(re);
    if (!hit) continue;
    const month = i + 1;
    const year = hit[2] ? Number(hit[2]) : month > m ? y - 1 : y;
    return ym(year, month);
  }
  return null;
}

export function currentMonth(now = new Date()) {
  return ym(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}
