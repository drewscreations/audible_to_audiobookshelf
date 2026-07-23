/**
 * Direct Audible API access using the same identity tokens Libation holds.
 *
 * Tokens come from AccountsSettings.json (read via Portainer, see
 * libation-auth.ts). Expired access tokens are refreshed automatically and
 * written back so Libation benefits too.
 *
 * Endpoints used (unofficial Audible API):
 *   GET /1.0/library?response_groups=percent_complete → per-book progress %
 *   GET /1.0/annotations/lastpositions?asins=...      → precise position in ms
 */

import {
  readAccountsSettings,
  writeAccountsSettings,
  refreshAudibleToken,
} from "./libation-auth";

export interface AudibleAuth {
  accountId: string;
  accountName: string;
  locale: string;
  accessToken: string;
}

export interface AudibleLibraryItem {
  asin: string;
  title: string;
  percentComplete: number; // 0-100
  isFinished: boolean;
  runtimeLengthMin?: number;
}

export interface AudibleLastPosition {
  asin: string;
  positionMs: number;
  lastUpdated?: string;
}

/** Audible API host per Libation locale name. */
const API_DOMAINS: Record<string, string> = {
  us: "api.audible.com",
  uk: "api.audible.co.uk",
  germany: "api.audible.de",
  france: "api.audible.fr",
  canada: "api.audible.ca",
  australia: "api.audible.com.au",
  india: "api.audible.in",
  italy: "api.audible.it",
  spain: "api.audible.es",
  japan: "api.audible.co.jp",
  brazil: "api.audible.com.br",
};

function apiBase(locale: string): string {
  const domain = API_DOMAINS[locale.toLowerCase()] || "api.audible.com";
  return `https://${domain}`;
}

/**
 * Load every Audible account's auth, refreshing expired access tokens.
 * Refreshed tokens are persisted back to the Libation config.
 */
export async function getAudibleAuths(): Promise<AudibleAuth[]> {
  const settings = await readAccountsSettings();
  const auths: AudibleAuth[] = [];
  let dirty = false;

  for (const account of settings.Accounts || []) {
    const tokens = account.IdentityTokens;
    if (!tokens?.ExistingAccessToken) continue;

    const expires = tokens.ExistingAccessToken.Expires;
    const expiringSoon =
      !expires || new Date(expires).getTime() < Date.now() + 5 * 60_000;

    if (expiringSoon) {
      const refreshToken = tokens.RefreshToken?.Value;
      if (!refreshToken) continue;
      const result = await refreshAudibleToken(refreshToken);
      tokens.ExistingAccessToken.TokenValue = result.accessToken;
      tokens.ExistingAccessToken.Expires = result.expires;
      dirty = true;
    }

    auths.push({
      accountId: account.AccountId,
      accountName: account.AccountName || account.AccountId,
      locale: tokens.LocaleName || "us",
      accessToken: tokens.ExistingAccessToken.TokenValue,
    });
  }

  if (dirty) {
    try {
      await writeAccountsSettings(settings);
    } catch (e) {
      // Non-fatal: the refreshed token still works for this run
      console.error("[audible-api] failed to persist refreshed tokens:", e);
    }
  }

  return auths;
}

async function audibleGet(
  auth: AudibleAuth,
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params).toString();
  const url = `${apiBase(auth.locale)}${path}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Audible GET ${path} failed (${res.status}): ${text.slice(0, 300)}`
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Fetch the account's full library with per-book completion percent.
 */
export async function getLibraryProgress(
  auth: AudibleAuth
): Promise<AudibleLibraryItem[]> {
  const items: AudibleLibraryItem[] = [];
  const numResults = 1000;

  for (let page = 1; page <= 10; page++) {
    const data = await audibleGet(auth, "/1.0/library", {
      response_groups: "percent_complete,product_attrs",
      num_results: String(numResults),
      page: String(page),
      sort_by: "-PurchaseDate",
    });

    const rawItems = (data.items as Array<Record<string, unknown>>) || [];
    for (const raw of rawItems) {
      const asin = typeof raw.asin === "string" ? raw.asin : null;
      if (!asin) continue;
      const percent =
        typeof raw.percent_complete === "number" ? raw.percent_complete : 0;
      items.push({
        asin,
        title: typeof raw.title === "string" ? raw.title : asin,
        percentComplete: Math.max(0, Math.min(100, percent)),
        isFinished: raw.is_finished === true,
        runtimeLengthMin:
          typeof raw.runtime_length_min === "number"
            ? raw.runtime_length_min
            : undefined,
      });
    }

    if (rawItems.length < numResults) break;
  }

  return items;
}

/**
 * Fetch total listening milliseconds per day for the last few days.
 * Used as a cheap change-detector: if the totals haven't moved since the last
 * check, there was no Audible listening and the full progress sync can be
 * skipped. Throws on failure — callers fall back to a full sync.
 */
export async function getListeningStats(
  auth: AudibleAuth,
  days: number = 3
): Promise<Array<{ date: string; ms: number }>> {
  const start = new Date(Date.now() - (days - 1) * 86_400_000);
  const startDate = start.toISOString().slice(0, 10);
  const data = await audibleGet(auth, "/1.0/stats/aggregates", {
    daily_listening_interval_duration: String(days),
    daily_listening_interval_start_date: startDate,
    store: "Audible",
  });

  const raw =
    (data.aggregated_daily_listening_stats as Array<Record<string, unknown>>) ||
    [];
  if (raw.length === 0) {
    // Shape drift here would silently neuter the change gate — make it visible
    console.log(
      "[audible-api] stats/aggregates returned no daily buckets; raw response:",
      JSON.stringify(data).slice(0, 600)
    );
  }
  const parsed = raw
    .map((d) => ({
      // Daily buckets are keyed by interval_identifier ("YYYY-MM-DD")
      date:
        typeof d.interval_identifier === "string"
          ? d.interval_identifier
          : typeof d.date === "string"
            ? d.date
            : "",
      ms: Number(d.aggregated_sum) || 0,
    }))
    .filter((d) => d.date);
  if (raw.length > 0 && parsed.length === 0) {
    console.log(
      "[audible-api] stats entries unparsed; first raw entry:",
      JSON.stringify(raw[0]).slice(0, 400)
    );
  }
  return parsed;
}

/**
 * Fetch precise last-heard positions for a set of ASINs.
 * Returns a map asin → position. ASINs with no position are omitted.
 * Any failure returns what was collected so far — callers fall back to
 * percent_complete.
 */
export async function getLastPositions(
  auth: AudibleAuth,
  asins: string[]
): Promise<Map<string, AudibleLastPosition>> {
  const positions = new Map<string, AudibleLastPosition>();

  // The endpoint rejects large ASIN lists (400 validation error) — batch small
  for (let i = 0; i < asins.length; i += 25) {
    const batch = asins.slice(i, i + 25);
    try {
      const data = await audibleGet(auth, "/1.0/annotations/lastpositions", {
        asins: batch.join(","),
      });
      const entries = (data.asins as Array<Record<string, unknown>>) || [];
      for (const entry of entries) {
        const asin = typeof entry.asin === "string" ? entry.asin : null;
        const lph = entry.last_position_heard as
          | Record<string, unknown>
          | undefined;
        if (!asin || !lph) continue;
        if (lph.status && lph.status !== "Exists") continue;
        const posMs = Number(lph.position_ms);
        if (!Number.isFinite(posMs) || posMs <= 0) continue;
        positions.set(asin, {
          asin,
          positionMs: posMs,
          lastUpdated:
            typeof lph.last_updated === "string" ? lph.last_updated : undefined,
        });
      }
    } catch (e) {
      console.error(
        `[audible-api] lastpositions batch failed (${auth.accountName}):`,
        e instanceof Error ? e.message : e
      );
      break;
    }
  }

  return positions;
}
