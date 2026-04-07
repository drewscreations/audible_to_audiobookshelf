import type { AudibleAggregateDay } from "./types";

const REQUIRED_FIELDS = new Set([
  "Start Date",
  "Event Duration Milliseconds",
  "Start Position Milliseconds",
  "End Position Milliseconds",
  "Product Name",
  "ASIN",
  "Book Length Milliseconds",
]);

function cleanFieldname(name: string): string {
  if (!name) return "";
  name = name.trim();
  // Strip BOM
  name = name.replace(/^\ufeff/, "");
  // Strip surrounding quotes
  if (name.length >= 2 && name[0] === '"' && name[name.length - 1] === '"') {
    name = name.slice(1, -1);
  }
  return name.trim();
}

function safeInt(x: unknown, def = 0): number {
  if (x == null) return def;
  const s = String(x).trim();
  if (s === "") return def;
  const n = parseInt(s, 10);
  return isNaN(n) ? def : n;
}

function parseDateYMD(s: string): string | null {
  const trimmed = (s || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export interface ParseResult {
  days: AudibleAggregateDay[];
  stats: {
    rowsRead: number;
    rowsAggregated: number;
    uniqueAsins: number;
    deduped: number;
    dateRange: { first: string; last: string } | null;
  };
}

/**
 * Parse and aggregate Audible Listening.csv data (already parsed by PapaParse).
 * Port of Python `aggregate_audible_listening()`.
 */
export function aggregateAudibleListening(
  rows: Record<string, string>[],
  headers: string[],
  sinceDate?: string
): ParseResult {
  // Normalize headers
  const cleanHeaders = headers.map(cleanFieldname);
  const missing = [...REQUIRED_FIELDS].filter(
    (f) => !cleanHeaders.includes(f)
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required CSV fields: ${missing.join(", ")}. Got: ${cleanHeaders.join(", ")}`
    );
  }

  // Build header index map
  const headerMap: Record<string, number> = {};
  cleanHeaders.forEach((h, i) => {
    headerMap[h] = i;
  });

  // Aggregation state
  const aggs = new Map<
    string,
    {
      asin: string;
      date: string;
      title: string;
      totalListenSeconds: number;
      minStartPosMs: number;
      maxEndPosMs: number;
    }
  >();
  const asinDates = new Map<string, { first: string; last: string }>();
  const dedupeSeen = new Set<string>();
  let deduped = 0;

  for (const rawRow of rows) {
    // Normalize row keys
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawRow)) {
      row[cleanFieldname(k)] = v;
    }

    const asin = (row["ASIN"] || "").trim();
    if (!asin) continue;

    const dateStr = parseDateYMD(row["Start Date"] || "");
    if (!dateStr) continue;

    if (sinceDate && dateStr < sinceDate) continue;

    const durationMs = safeInt(row["Event Duration Milliseconds"]);
    const startPosMs = safeInt(row["Start Position Milliseconds"]);
    const endPosMs = safeInt(row["End Position Milliseconds"]);

    // Deduplicate
    const dedupeKey = `${dateStr}|${asin}|${startPosMs}|${endPosMs}|${durationMs}`;
    if (dedupeSeen.has(dedupeKey)) {
      deduped++;
      continue;
    }
    dedupeSeen.add(dedupeKey);

    const title = (row["Product Name"] || "").trim();
    const key = `${asin}|${dateStr}`;

    const existing = aggs.get(key);
    if (!existing) {
      aggs.set(key, {
        asin,
        date: dateStr,
        title,
        totalListenSeconds: durationMs / 1000,
        minStartPosMs: startPosMs,
        maxEndPosMs: endPosMs,
      });
    } else {
      if (title && title.length > existing.title.length) {
        existing.title = title;
      }
      existing.minStartPosMs = Math.min(existing.minStartPosMs, startPosMs);
      existing.maxEndPosMs = Math.max(existing.maxEndPosMs, endPosMs);
      existing.totalListenSeconds += durationMs / 1000;
    }

    // Track first/last dates per ASIN
    const dates = asinDates.get(asin);
    if (!dates) {
      asinDates.set(asin, { first: dateStr, last: dateStr });
    } else {
      if (dateStr < dates.first) dates.first = dateStr;
      if (dateStr > dates.last) dates.last = dateStr;
    }
  }

  // Build sorted result
  const entries = [...aggs.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const days: AudibleAggregateDay[] = entries.map(([, a]) => {
    const dates = asinDates.get(a.asin) || { first: a.date, last: a.date };
    return {
      asin: a.asin,
      date: a.date,
      title: a.title,
      totalListenSeconds: a.totalListenSeconds,
      minStartPosMs: a.minStartPosMs,
      maxEndPosMs: a.maxEndPosMs,
      firstListenDate: dates.first,
      lastListenDate: dates.last,
    };
  });

  const uniqueAsins = new Set(days.map((d) => d.asin));
  const allDates = days.map((d) => d.date).sort();

  return {
    days,
    stats: {
      rowsRead: rows.length,
      rowsAggregated: days.length,
      uniqueAsins: uniqueAsins.size,
      deduped,
      dateRange:
        allDates.length > 0
          ? { first: allDates[0], last: allDates[allDates.length - 1] }
          : null,
    },
  };
}
