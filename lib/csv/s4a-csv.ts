import type { S4aConfig } from "@/db/schema/expenses";
import { guessDateFormat, parseDate, type DateFormat } from "./expenses-csv";

export const S4A_METRICS = ["streams", "listeners", "saves", "playlist_adds", "followers"] as const;
export type S4aMetric = (typeof S4A_METRICS)[number];

export const S4A_METRIC_LABEL: Record<S4aMetric, string> = {
  streams: "Streams",
  listeners: "Listeners",
  saves: "Saves",
  playlist_adds: "Playlist adds",
  followers: "Followers",
};

const METRIC_HINTS: Record<S4aMetric, RegExp> = {
  streams: /^(streams|total streams|stream count)$/i,
  listeners: /^(listeners|monthly listeners|unique listeners)$/i,
  saves: /^(saves|savers|total saves)$/i,
  playlist_adds: /^(playlist[ _]adds|playlist additions)$/i,
  followers: /^(followers|total followers)$/i,
};
const DATE_HINT = /^(date|day|period end|end date)$/i;
const TRACK_HINT = /^(song|track|track name|song name|title|isrc|spotify uri|track uri|uri)$/i;

/**
 * Spotify for Artists exports come in a few shapes: the audience timeline (date + listeners /
 * streams / followers), a single song's timeline (date + streams), and the Songs tab summary
 * (song + streams / listeners / saves, no date). There is no S4A API, so these CSVs are the only
 * source of streams and listeners.
 */
export function guessS4aConfig(headers: string[], sample: string[][] = []): S4aConfig {
  const dateColumn = headers.find((h) => DATE_HINT.test(h.trim())) ?? null;
  const trackColumn = headers.find((h) => TRACK_HINT.test(h.trim())) ?? null;
  const metrics: S4aConfig["metrics"] = {};
  for (const m of S4A_METRICS) {
    const col = headers.find((h) => METRIC_HINTS[m].test(h.trim()));
    if (col) metrics[m] = col;
  }
  let dateFormat: DateFormat = "YYYY-MM-DD";
  if (dateColumn) {
    const idx = headers.indexOf(dateColumn);
    dateFormat = guessDateFormat(sample.map((r) => r[idx]?.trim() ?? "").filter(Boolean));
  }
  return { dateColumn, dateFormat, fixedDate: null, metrics, trackColumn, fixedTrackId: null };
}

export function validateS4aConfig(headers: string[], c: S4aConfig): string | null {
  const has = (col: string | null | undefined) => !col || headers.includes(col);
  if (!c.dateColumn && !c.fixedDate) return "Choose the date column, or enter the last day of the period this file covers.";
  if (!has(c.dateColumn) || !has(c.trackColumn)) return "A chosen column isn't in this file.";
  const cols = Object.values(c.metrics).filter(Boolean);
  if (cols.length === 0) return "Choose at least one metric column (streams, listeners, saves…).";
  if (!cols.every((col) => headers.includes(col!))) return "A chosen metric column isn't in this file.";
  if (new Set(cols).size !== cols.length) return "Each metric needs its own column.";
  return null;
}

/** "12,480" → 12480. Returns null for blanks and anything that isn't a whole, non-negative number. */
export function parseCount(raw: string | undefined): number | null {
  const v = (raw ?? "").trim().replace(/[,\s]/g, "");
  if (v === "" || v === "-") return null;
  if (!/^\d+(\.0+)?$/.test(v)) return Number.NaN;
  return Number.parseInt(v, 10);
}

export type S4aPoint = { line: number; date: string; trackText: string | null; metric: S4aMetric; value: number };
export type S4aRowError = { line: number; message: string };

export function transformS4aRows(headers: string[], rows: string[][], c: S4aConfig) {
  const idx = (col: string | null | undefined) => (col ? headers.indexOf(col) : -1);
  const dateIdx = idx(c.dateColumn);
  const trackIdx = idx(c.trackColumn);
  const metricIdx = S4A_METRICS.flatMap((m) => (c.metrics[m] ? [[m, idx(c.metrics[m])] as const] : []));
  const points: S4aPoint[] = [];
  const errors: S4aRowError[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const date = dateIdx >= 0 ? parseDate(r[dateIdx] ?? "", c.dateFormat as DateFormat) : c.fixedDate;
    if (!date) {
      errors.push({ line, message: `“${r[dateIdx] ?? ""}” isn't a ${c.dateFormat} date.` });
      return;
    }
    const trackText = trackIdx >= 0 ? (r[trackIdx] ?? "").trim() || null : null;
    if (trackIdx >= 0 && !trackText) {
      errors.push({ line, message: "The song column is empty." });
      return;
    }
    for (const [metric, col] of metricIdx) {
      const value = parseCount(r[col]);
      if (value === null) continue;
      if (Number.isNaN(value)) {
        errors.push({ line, message: `“${r[col]}” isn't a whole number (${S4A_METRIC_LABEL[metric]}).` });
        continue;
      }
      points.push({ line, date, trackText, metric, value });
    }
  });
  return { points, errors };
}

/** Matches a song column value (ISRC, Spotify URI/URL, or title) to a linked track. */
export function matchTrack<T extends { id: string; spotifyTrackId: string; isrc: string | null; name: string }>(
  text: string,
  tracks: T[],
): T | null {
  const v = text.trim();
  const isrc = v.toUpperCase().replace(/-/g, "");
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return tracks.find((t) => t.isrc?.toUpperCase() === isrc) ?? null;
  const uri = v.match(/(?:spotify:track:|open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/)([0-9A-Za-z]{22})/);
  if (uri) return tracks.find((t) => t.spotifyTrackId === uri[1]) ?? null;
  const name = v.toLowerCase();
  const byName = tracks.filter((t) => t.name.toLowerCase() === name);
  return byName.length === 1 ? byName[0] : null;
}
