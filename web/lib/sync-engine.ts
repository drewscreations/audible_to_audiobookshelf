/**
 * Auto-sync engine: gets new Audible purchases into Audiobookshelf with no
 * manual steps.
 *
 * Each cycle:
 *   1. Skip if LibationCli is already running (container's own loop or manual run)
 *   2. LibationCli scan  → discovers new purchases into the Libation DB
 *   3. If any books are pending, LibationCli liberate → downloads them to /data
 *   4. Diff the DB to see what actually downloaded
 *   5. Check for Libation's nested-folder bug and warn
 *   6. Trigger an ABS scan on every book library so new files show up immediately
 *
 * The scheduler is started once from instrumentation.ts. State lives on
 * globalThis so API route handlers and the scheduler share one instance
 * regardless of module-graph duplication.
 */

import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join, relative, sep, extname } from "path";
import { loadConfig, saveConfig } from "./config";
import { libationScan, libationDownload, isLibationBusy } from "./libation-exec";
import { getLibationBooks } from "./libation-db";
import { ABSClient } from "./abs-client";
import type {
  AppConfig,
  AutoSyncSettings,
  SyncCycleResult,
  SyncStatus,
} from "./types";

const LOG_PATH = join(/* turbopackIgnore: true */ process.cwd(), "data", "sync-log.json");
const MAX_LOG_ENTRIES = 100;
const FIRST_RUN_DELAY_MS = 15_000; // let the stack settle after boot
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;

const AUDIO_EXTS = new Set([".m4b", ".m4a", ".mp3", ".flac", ".ogg", ".opus"]);

interface EngineState {
  cycleRunning: boolean;
  schedulerStarted: boolean;
  timer?: ReturnType<typeof setTimeout>;
  lastRunAt?: string;
  nextRunAt?: string;
  lastResult?: SyncCycleResult;
  activity?: SyncCycleResult[];
}

const globalStore = globalThis as unknown as { __autoSyncEngine?: EngineState };

function getState(): EngineState {
  if (!globalStore.__autoSyncEngine) {
    globalStore.__autoSyncEngine = { cycleRunning: false, schedulerStarted: false };
  }
  return globalStore.__autoSyncEngine;
}

// ── Settings ──

export function getSettings(): AutoSyncSettings {
  const config = loadConfig();
  const settings = config.autoSync || { enabled: true, intervalMinutes: 10 };
  return {
    enabled: settings.enabled !== false,
    intervalMinutes: clampInterval(settings.intervalMinutes),
    syncProgress: settings.syncProgress !== false,
    accountMap: settings.accountMap || {},
  };
}

function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return 10;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes)));
}

export function updateSettings(partial: Partial<AutoSyncSettings>): AutoSyncSettings {
  const current = getSettings();
  const next: AutoSyncSettings = {
    enabled: partial.enabled ?? current.enabled,
    intervalMinutes: clampInterval(partial.intervalMinutes ?? current.intervalMinutes),
    syncProgress: partial.syncProgress ?? current.syncProgress,
    accountMap: partial.accountMap ?? current.accountMap,
  };
  saveConfig({ autoSync: next });

  const state = getState();
  if (state.schedulerStarted) {
    // Re-arm the timer under the new settings. Newly enabled → run soon so the
    // user sees it kick in; otherwise wait a full interval.
    const justEnabled = next.enabled && !current.enabled;
    scheduleNext(justEnabled ? 5_000 : undefined);
  }
  return next;
}

// ── Activity log ──

function getActivity(): SyncCycleResult[] {
  const state = getState();
  if (!state.activity) {
    try {
      state.activity = JSON.parse(readFileSync(LOG_PATH, "utf-8")) as SyncCycleResult[];
    } catch {
      state.activity = [];
    }
  }
  return state.activity;
}

function appendActivity(result: SyncCycleResult) {
  const activity = getActivity();
  activity.unshift(result);
  if (activity.length > MAX_LOG_ENTRIES) activity.length = MAX_LOG_ENTRIES;
  try {
    const dir = join(process.cwd(), "data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LOG_PATH, JSON.stringify(activity, null, 2));
  } catch (e) {
    console.error("[auto-sync] failed to persist activity log:", e);
  }
}

// ── Nested-folder detection (known Libation bug) ──

/**
 * Libation occasionally writes one book's folder inside another's
 * (e.g. "Book 8/Book 7/Book 7.m4b"), which confuses ABS. Detect any folder
 * containing audio files that sits inside another folder containing audio files.
 */
export function findNestedBookFolders(root: string): string[] {
  if (!existsSync(root)) return [];

  const audioDirs: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasAudio = entries.some(
      (e) => e.isFile() && AUDIO_EXTS.has(extname(e.name).toLowerCase())
    );
    if (hasAudio && dir !== root) audioDirs.push(dir);
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) {
        walk(join(dir, e.name), depth + 1);
      }
    }
  };
  walk(root, 0);

  const warnings: string[] = [];
  for (const child of audioDirs) {
    const parent = audioDirs.find((p) => p !== child && child.startsWith(p + sep));
    if (parent) {
      warnings.push(
        `"${relative(root, child)}" is nested inside book folder "${relative(root, parent)}" — move it to the top level and rescan`
      );
    }
  }
  return warnings;
}

function getBooksDir(): string {
  return process.env.BOOKS_DIR || "/audiobooks/Audiobooks";
}

// ── ABS scan trigger ──

function getAdminToken(config: AppConfig): string | undefined {
  return (
    config.tokens["root"] ||
    config.tokens["default"] ||
    config.tokens[config.activeUser] ||
    Object.values(config.tokens)[0]
  );
}

async function triggerAbsScans(result: SyncCycleResult) {
  const config = loadConfig();
  const token = getAdminToken(config);
  if (!token) {
    result.errors.push("ABS scan skipped: no ABS token configured");
    return;
  }
  const client = new ABSClient(config.absUrl, token);
  let libraries;
  try {
    libraries = await client.libraries();
  } catch (e) {
    result.errors.push(`ABS scan failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  for (const lib of libraries) {
    if (lib.mediaType !== "book") continue;
    try {
      await client.scanLibrary(lib.id);
      result.absLibrariesScanned.push(lib.name);
    } catch (e) {
      result.errors.push(
        `ABS scan of "${lib.name}" failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }
}

// ── Sync cycle ──

type BookSnapshot = Map<string, { title: string; isDownloaded: boolean }>;

function snapshotBooks(): BookSnapshot {
  const map: BookSnapshot = new Map();
  for (const book of getLibationBooks()) {
    map.set(book.asin, { title: book.title, isDownloaded: book.isDownloaded });
  }
  return map;
}

export async function runSyncCycle(
  trigger: "scheduled" | "manual"
): Promise<SyncCycleResult> {
  const state = getState();
  const startedAt = new Date().toISOString();
  const result: SyncCycleResult = {
    id: randomUUID(),
    startedAt,
    finishedAt: startedAt,
    trigger,
    newBooks: [],
    downloaded: [],
    nestingWarnings: [],
    absLibrariesScanned: [],
    errors: [],
  };

  if (state.cycleRunning) {
    result.skipped = "cycle-in-progress";
    result.finishedAt = new Date().toISOString();
    return result;
  }
  state.cycleRunning = true;

  try {
    if (await isLibationBusy()) {
      result.skipped = "libation-busy";
      console.log("[auto-sync] skipped: LibationCli already running");
      return result;
    }

    // Snapshot before the scan so we can tell which books are new purchases.
    let before: BookSnapshot | null = null;
    try {
      before = snapshotBooks();
    } catch (e) {
      result.errors.push(
        `Libation DB read failed: ${e instanceof Error ? e.message : e}`
      );
    }

    try {
      await libationScan();
    } catch (e) {
      result.errors.push(`Scan failed: ${e instanceof Error ? e.message : e}`);
    }

    let afterScan: BookSnapshot | null = null;
    try {
      afterScan = snapshotBooks();
    } catch (e) {
      result.errors.push(
        `Libation DB read failed after scan: ${e instanceof Error ? e.message : e}`
      );
    }

    if (afterScan) {
      if (before) {
        for (const [asin, book] of afterScan) {
          if (!before.has(asin)) result.newBooks.push({ asin, title: book.title });
        }
      }

      const pending = [...afterScan].filter(([, b]) => !b.isDownloaded);
      if (pending.length > 0) {
        console.log(
          `[auto-sync] ${pending.length} book(s) pending download, liberating...`
        );
        try {
          await libationDownload({});
        } catch (e) {
          result.errors.push(
            `Download failed: ${e instanceof Error ? e.message : e}`
          );
        }

        try {
          const afterLiberate = snapshotBooks();
          for (const [asin] of pending) {
            const now = afterLiberate.get(asin);
            if (now?.isDownloaded) {
              result.downloaded.push({ asin, title: now.title });
            }
          }
        } catch (e) {
          result.errors.push(
            `Libation DB read failed after download: ${e instanceof Error ? e.message : e}`
          );
        }
      }
    }

    if (result.downloaded.length > 0) {
      try {
        result.nestingWarnings = findNestedBookFolders(getBooksDir());
      } catch (e) {
        result.errors.push(
          `Nesting check failed: ${e instanceof Error ? e.message : e}`
        );
      }
      await triggerAbsScans(result);
    }

    // ── Listening progress + history sync (Audible → ABS) ──
    // Scheduled cycles use the cheap stats gate; manual runs sync fully.
    if (getSettings().syncProgress) {
      try {
        const { syncListeningProgress } = await import("./progress-sync");
        const progress = await syncListeningProgress({
          force: trigger === "manual",
        });
        result.progressUpdated = progress.progressUpdated;
        result.sessionsSynced = progress.sessionsSynced;
        result.errors.push(...progress.errors);
      } catch (e) {
        result.errors.push(
          `Progress sync failed: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  } finally {
    state.cycleRunning = false;
    result.finishedAt = new Date().toISOString();
    state.lastRunAt = result.finishedAt;
    // A busy-skip shouldn't hide the last real result in the UI
    if (!result.skipped) state.lastResult = result;

    const notable =
      result.newBooks.length > 0 ||
      result.downloaded.length > 0 ||
      result.nestingWarnings.length > 0 ||
      (result.progressUpdated || 0) > 0 ||
      (result.sessionsSynced || 0) > 0 ||
      result.errors.length > 0 ||
      trigger === "manual";
    if (notable && !result.skipped) appendActivity(result);

    const secs = Math.round(
      (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000
    );
    if (!result.skipped) {
      console.log(
        `[auto-sync] ${trigger} cycle done in ${secs}s: ` +
          `${result.newBooks.length} new, ${result.downloaded.length} downloaded` +
          (result.progressUpdated !== undefined
            ? `, progress: ${result.progressUpdated} book(s), ${result.sessionsSynced ?? 0} session(s)`
            : "") +
          (result.absLibrariesScanned.length > 0
            ? `, ABS scan: ${result.absLibrariesScanned.join(", ")}`
            : "") +
          (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : "")
      );
      for (const err of result.errors) console.error(`[auto-sync]   ${err}`);
    }
  }

  return result;
}

// ── Scheduler ──

function scheduleNext(delayMs?: number) {
  const state = getState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  const settings = getSettings();
  if (!settings.enabled) {
    state.nextRunAt = undefined;
    return;
  }
  const delay = delayMs ?? settings.intervalMinutes * 60_000;
  state.nextRunAt = new Date(Date.now() + delay).toISOString();
  state.timer = setTimeout(tick, delay);
  // Don't hold the process open just for the timer (also keeps tests clean).
  state.timer.unref?.();
}

async function tick() {
  try {
    await runSyncCycle("scheduled");
  } catch (e) {
    console.error("[auto-sync] cycle crashed:", e);
  }
  scheduleNext();
}

/** Start the background scheduler. Called once from instrumentation.ts. */
export function startScheduler() {
  const state = getState();
  if (state.schedulerStarted) return;
  state.schedulerStarted = true;
  const settings = getSettings();
  console.log(
    `[auto-sync] scheduler started (${settings.enabled ? `every ${settings.intervalMinutes}m` : "disabled"})`
  );
  scheduleNext(FIRST_RUN_DELAY_MS);
}

// ── Status ──

export function getSyncStatus(): SyncStatus {
  const state = getState();
  const settings = getSettings();
  return {
    settings,
    schedulerActive: state.schedulerStarted && settings.enabled,
    cycleRunning: state.cycleRunning,
    lastRunAt: state.lastRunAt,
    nextRunAt: settings.enabled ? state.nextRunAt : undefined,
    lastResult: state.lastResult,
    activity: getActivity().slice(0, 20),
  };
}
