import { v5 as uuidv5 } from "uuid";
import type { AudibleAggregateDay, ABSLibraryItem, SyncSession, ProgressUpdate } from "./types";

// UUID v5 namespace - must match Python: uuid.NAMESPACE_DNS
const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Create a stable epoch timestamp for a date at midday UTC.
 * Port of Python `_epoch_ms_for_date_midday()`.
 */
function epochMsForDateMidday(
  dateStr: string,
  offsetSeconds: number = 0
): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return d.getTime() + offsetSeconds * 1000;
}

/**
 * Build local playback sessions from matched Audible days.
 * Port of Python session builder (lines 586-639).
 */
export function buildSessions(
  matched: Array<{ day: AudibleAggregateDay; item: ABSLibraryItem }>,
  userId: string
): SyncSession[] {
  return matched.map(({ day, item }, idx) => {
    const media = item.media;
    const md = media?.metadata || {};
    const durationSec = media?.duration || 0;
    const startSec = day.minStartPosMs / 1000;
    const currentSec = day.maxEndPosMs / 1000;

    // Stable UUID per (asin, date) — matches Python uuid5(NAMESPACE_DNS, "audible:{asin}:{date}")
    const sid = uuidv5(`audible:${day.asin}:${day.date}`, NAMESPACE_DNS);

    const startedAt = epochMsForDateMidday(day.date, idx % 3600);
    const updatedAt = startedAt + Math.floor(day.totalListenSeconds * 1000);

    const d = new Date(day.date);
    const dayOfWeek = DAY_NAMES[d.getUTCDay()];

    return {
      id: sid,
      userId,
      libraryId: item.libraryId,
      libraryItemId: item.id,
      mediaType: "book" as const,
      mediaMetadata: {
        title: md.title || day.title || "",
        authorName: md.authorName || "",
      },
      displayTitle: md.title || day.title || "",
      displayAuthor: md.authorName || "",
      coverPath: media?.coverPath || "",
      duration: durationSec,
      playMethod: 3 as const,
      mediaPlayer: "AudibleImport" as const,
      deviceInfo: {
        ipAddress: "",
        browserName: "",
        osName: "AudibleImport",
        clientVersion: "1.0",
      },
      date: day.date,
      dayOfWeek,
      timeListening: day.totalListenSeconds,
      startTime: startSec,
      currentTime: currentSec,
      startedAt,
      updatedAt,
    };
  });
}

/**
 * Build progress updates from matched Audible days.
 * Port of Python progress builder (lines 686-737).
 */
export function buildProgressUpdates(
  matched: Array<{ day: AudibleAggregateDay; item: ABSLibraryItem }>,
  finishThreshold: number = 0.99
): ProgressUpdate[] {
  const perItem = new Map<
    string,
    {
      libraryItemId: string;
      duration: number;
      currentTime: number;
      first: string;
      last: string;
    }
  >();

  for (const { day, item } of matched) {
    const itemId = item.id;
    const duration = item.media?.duration || 0;
    const currentTime = day.maxEndPosMs / 1000;

    const existing = perItem.get(itemId);
    if (!existing) {
      perItem.set(itemId, {
        libraryItemId: itemId,
        duration,
        currentTime,
        first: day.firstListenDate,
        last: day.lastListenDate,
      });
    } else {
      existing.currentTime = Math.max(existing.currentTime, currentTime);
      if (day.firstListenDate < existing.first) existing.first = day.firstListenDate;
      if (day.lastListenDate > existing.last) existing.last = day.lastListenDate;
    }
  }

  const updates: ProgressUpdate[] = [];
  for (const p of perItem.values()) {
    const duration = p.duration;
    const cur = p.currentTime;
    let progress = duration > 0 ? cur / duration : 0;
    progress = Math.max(0, Math.min(1, progress));
    const isFinished =
      progress >= finishThreshold ||
      (duration > 0 && cur >= Math.max(0, duration - 60));

    const startedAt = epochMsForDateMidday(p.first);
    const lastUpdate = epochMsForDateMidday(p.last);

    updates.push({
      libraryItemId: p.libraryItemId,
      episodeId: null,
      duration,
      currentTime: cur,
      progress: isFinished ? 1.0 : progress,
      isFinished,
      startedAt,
      finishedAt: isFinished ? lastUpdate : null,
    });
  }

  return updates;
}

/** Split array into chunks */
export function chunked<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
