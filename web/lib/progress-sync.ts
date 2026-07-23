/**
 * Sync Audible listening progress + history into Audiobookshelf.
 *
 * Per Audible account:
 *   1. Pull the library with percent_complete, plus precise last-heard
 *      positions from the annotations endpoint
 *   2. Match books to ABS items by ASIN (across all book libraries)
 *   3. Push progress updates to the mapped ABS user — one-way, only when
 *      Audible is AHEAD of ABS, never regressing or un-finishing
 *   4. Derive listening sessions from position deltas between cycles and
 *      upsert one session per book per day (stable uuid5 id)
 *
 * Position state persists in data/audible-positions.json so deltas survive
 * restarts. First run pushes progress only (no fabricated history).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { ABSClient } from "./abs-client";
import {
  getAudibleAuths,
  getLibraryProgress,
  getLastPositions,
  getListeningStats,
  type AudibleAuth,
} from "./audible-api";
import { buildAsinIndex } from "./matching";
import { buildSessions, chunked } from "./session-builder";
import type {
  ABSLibraryItem,
  ABSMediaProgress,
  AppConfig,
  AudibleAggregateDay,
  ProgressSyncAccountResult,
  ProgressSyncSummary,
  ProgressUpdate,
} from "./types";

const STATE_PATH = join(/* turbopackIgnore: true */ process.cwd(), "data", "audible-positions.json");

/** Ignore position advances smaller than this (jitter, accidental taps). */
const MIN_DELTA_SEC = 5;
/** Don't count a single cycle's delta as more than this much listening. */
const MAX_DELTA_SEC = 4 * 3600;
/** Only push a day-session once it has at least this much listening. */
const MIN_SESSION_SEC = 30;
/** Only push progress when Audible is ahead of ABS by more than this. */
const PROGRESS_EPSILON_SEC = 30;
/** Run a full sync at least this often even when the stats gate sees no listening. */
const MAX_FULL_SYNC_INTERVAL_MS = 6 * 3600_000;

interface BookPositionState {
  positionMs: number;
  percent: number;
  updatedAt: string;
  day?: { date: string; startPosMs: number; listenSec: number };
}

interface AccountState {
  books: Record<string, BookPositionState>;
  /** Signature of recent daily listening totals — cheap change detector */
  statsSig?: string;
  lastFullSyncAt?: string;
}

interface PositionState {
  version: 2;
  accounts: Record<string, AccountState>;
}

function loadState(): PositionState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as Record<
      string,
      unknown
    >;
    if (raw.version === 2) return raw as unknown as PositionState;
    // v1: top-level map of accountId → asin → position
    const accounts: Record<string, AccountState> = {};
    for (const [accountId, books] of Object.entries(raw)) {
      accounts[accountId] = {
        books: books as Record<string, BookPositionState>,
      };
    }
    return { version: 2, accounts };
  } catch {
    return { version: 2, accounts: {} };
  }
}

function saveState(state: PositionState) {
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function localDate(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, server-local tz
}

function resolveAbsUser(
  config: AppConfig,
  auth: AudibleAuth,
  accountCount: number
): string | undefined {
  const map = config.autoSync?.accountMap || {};
  if (map[auth.accountId]) return map[auth.accountId];
  // Single Audible account: default to the active ABS user
  if (accountCount === 1) return config.activeUser;
  return undefined;
}

async function fetchAbsItems(client: ABSClient): Promise<ABSLibraryItem[]> {
  const libraries = await client.libraries();
  const all: ABSLibraryItem[] = [];
  for (const lib of libraries) {
    if (lib.mediaType !== "book") continue;
    all.push(...(await client.libraryItems(lib.id)));
  }
  return all;
}

async function syncAccount(
  config: AppConfig,
  auth: AudibleAuth,
  accountCount: number,
  state: PositionState,
  dryRun: boolean,
  force: boolean
): Promise<ProgressSyncAccountResult> {
  const result: ProgressSyncAccountResult = {
    accountId: auth.accountId,
    accountName: auth.accountName,
    matchedBooks: 0,
    progressUpdated: 0,
    sessionsSynced: 0,
    errors: [],
    examples: [],
  };

  const userKey = resolveAbsUser(config, auth, accountCount);
  if (!userKey || !config.tokens[userKey]) {
    result.skipped = `no ABS user mapped for Audible account "${auth.accountName}" — set it in Settings`;
    return result;
  }
  result.absUser = userKey;

  const acct = (state.accounts[auth.accountId] = state.accounts[
    auth.accountId
  ] || { books: {} });

  // ── Cheap change gate: one small stats call instead of a full sync ──
  // Daily listening totals only move when something was actually played.
  let newStatsSig: string | undefined;
  try {
    const stats = await getListeningStats(auth);
    newStatsSig = stats.map((s) => `${s.date}:${s.ms}`).join(",");
    const today = localDate();
    result.todayListeningMin = Math.round(
      (stats.find((s) => s.date === today)?.ms || 0) / 60_000
    );
  } catch (e) {
    // Gate unavailable → fail open and run the full sync
    console.error(
      `[progress-sync] stats gate failed (${auth.accountName}), running full sync:`,
      e instanceof Error ? e.message : e
    );
  }
  if (!force && newStatsSig !== undefined) {
    const lastFull = acct.lastFullSyncAt ? Date.parse(acct.lastFullSyncAt) : 0;
    const withinFloor = Date.now() - lastFull < MAX_FULL_SYNC_INTERVAL_MS;
    if (newStatsSig === acct.statsSig && withinFloor) {
      result.idle = true;
      result.skipped = "no new Audible listening";
      return result;
    }
  }

  const client = new ABSClient(config.absUrl, config.tokens[userKey]);
  const me = await client.meFull();
  const progressByItem = new Map<string, ABSMediaProgress>();
  for (const p of me.mediaProgress || []) {
    progressByItem.set(p.libraryItemId, p);
  }

  const asinIndex = buildAsinIndex(await fetchAbsItems(client));
  const audibleItems = await getLibraryProgress(auth);

  const candidates = audibleItems.filter(
    (b) => (b.percentComplete > 0 || b.isFinished) && asinIndex.has(b.asin)
  );
  result.matchedBooks = candidates.length;

  const positions = await getLastPositions(
    auth,
    candidates.map((b) => b.asin)
  );

  const accountState = acct.books;
  const today = localDate();
  const nowMs = Date.now();
  const updates: ProgressUpdate[] = [];
  const sessionDays: Array<{ day: AudibleAggregateDay; item: ABSLibraryItem }> =
    [];

  for (const book of candidates) {
    const item = asinIndex.get(book.asin)!;
    const absDuration = item.media?.duration || 0;
    // percent_complete library responses omit titles; ABS metadata has them
    const title = item.media?.metadata?.title || book.title;

    let posSec = positions.has(book.asin)
      ? positions.get(book.asin)!.positionMs / 1000
      : absDuration > 0
        ? (book.percentComplete / 100) * absDuration
        : 0;
    if (absDuration > 0) posSec = Math.min(posSec, absDuration);
    if (posSec <= 0 && !book.isFinished) continue;

    const posMs = Math.round(posSec * 1000);
    const prev = accountState[book.asin];

    // ── Sessions from position deltas ──
    let day = prev?.day;
    if (prev && posMs > prev.positionMs + MIN_DELTA_SEC * 1000) {
      const deltaSec = Math.min(
        (posMs - prev.positionMs) / 1000,
        MAX_DELTA_SEC
      );
      if (!day || day.date !== today) {
        day = { date: today, startPosMs: prev.positionMs, listenSec: 0 };
      }
      day.listenSec += deltaSec;
      if (day.listenSec >= MIN_SESSION_SEC) {
        sessionDays.push({
          day: {
            asin: book.asin,
            date: today,
            title,
            totalListenSeconds: Math.round(day.listenSec),
            minStartPosMs: day.startPosMs,
            maxEndPosMs: posMs,
            firstListenDate: today,
            lastListenDate: today,
          },
          item,
        });
      }
    }
    accountState[book.asin] = {
      positionMs: posMs,
      percent: book.percentComplete,
      updatedAt: new Date(nowMs).toISOString(),
      day,
    };

    // ── Progress (one-way: only when Audible is ahead) ──
    const absProg = progressByItem.get(item.id);
    if (absProg?.isFinished) continue;

    const threshold = config.finishThreshold || 0.99;
    const absCurrent = absProg?.currentTime || 0;
    // Never move ABS backwards, even when marking finished
    const targetSec = Math.max(posSec, absCurrent);
    let progress =
      absDuration > 0 ? targetSec / absDuration : book.percentComplete / 100;
    progress = Math.max(0, Math.min(1, progress));
    const isFinished = book.isFinished || progress >= threshold;

    if (posSec > absCurrent + PROGRESS_EPSILON_SEC || isFinished) {
      updates.push({
        libraryItemId: item.id,
        episodeId: null,
        duration: absDuration,
        currentTime: targetSec,
        progress: isFinished ? 1.0 : progress,
        isFinished,
        startedAt: absProg?.startedAt || nowMs,
        finishedAt: isFinished ? nowMs : null,
      });
      if (result.examples.length < 5) {
        const pct = Math.round(progress * 100);
        result.examples.push(
          `${title}: → ${pct}%${isFinished ? " (finished)" : ""}`
        );
      }
    }
  }

  // ── Push to ABS ──
  if (!dryRun) {
    for (const chunk of chunked(updates, config.batchSize || 250)) {
      try {
        await client.updateProgress(chunk);
        result.progressUpdated += chunk.length;
      } catch (e) {
        result.errors.push(
          `progress batch failed: ${e instanceof Error ? e.message : e}`
        );
      }
    }
    if (sessionDays.length > 0) {
      const sessions = buildSessions(sessionDays, me.id);
      for (const chunk of chunked(sessions, config.batchSize || 250)) {
        try {
          const resp = await client.syncSessions(chunk);
          const results = resp.results || [];
          const failed = results.filter((r) => r && r.success === false);
          result.sessionsSynced += results.length
            ? results.length - failed.length
            : chunk.length;
          for (const f of failed.slice(0, 3)) {
            result.errors.push(`session ${f.id} rejected: ${f.error || "?"}`);
          }
        } catch (e) {
          result.errors.push(
            `session sync failed: ${e instanceof Error ? e.message : e}`
          );
        }
      }
    }
  } else {
    result.progressUpdated = updates.length;
    result.sessionsSynced = sessionDays.length;
  }

  // Remember what we synced so the gate can skip until the totals move again.
  // Skipped on errors so the next cycle retries a full sync.
  if (!dryRun && result.errors.length === 0) {
    acct.lastFullSyncAt = new Date().toISOString();
    if (newStatsSig !== undefined) acct.statsSig = newStatsSig;
  }

  return result;
}

/**
 * Run a full listening-progress sync across all Audible accounts.
 */
export async function syncListeningProgress(options?: {
  dryRun?: boolean;
  /** Skip the no-new-listening gate (manual runs and dry runs are always full) */
  force?: boolean;
}): Promise<ProgressSyncSummary> {
  const dryRun = options?.dryRun === true;
  const force = options?.force === true || dryRun;
  const config = loadConfig();
  const summary: ProgressSyncSummary = {
    dryRun,
    accounts: [],
    progressUpdated: 0,
    sessionsSynced: 0,
    errors: [],
  };

  let auths: AudibleAuth[];
  try {
    auths = await getAudibleAuths();
  } catch (e) {
    summary.errors.push(
      `Audible auth unavailable: ${e instanceof Error ? e.message : e}`
    );
    return summary;
  }
  if (auths.length === 0) {
    summary.errors.push("No Audible accounts with tokens found");
    return summary;
  }

  const state = loadState();

  for (const auth of auths) {
    try {
      const result = await syncAccount(
        config,
        auth,
        auths.length,
        state,
        dryRun,
        force
      );
      summary.accounts.push(result);
      summary.progressUpdated += result.progressUpdated;
      summary.sessionsSynced += result.sessionsSynced;
      summary.errors.push(...result.errors);
      // Idle skips (no new listening) are normal, not errors
      if (result.skipped && !result.idle) summary.errors.push(result.skipped);
    } catch (e) {
      const msg = `progress sync (${auth.accountName}): ${e instanceof Error ? e.message : e}`;
      summary.errors.push(msg);
      summary.accounts.push({
        accountId: auth.accountId,
        accountName: auth.accountName,
        matchedBooks: 0,
        progressUpdated: 0,
        sessionsSynced: 0,
        errors: [msg],
        examples: [],
      });
    }
  }

  if (!dryRun) saveState(state);
  return summary;
}
