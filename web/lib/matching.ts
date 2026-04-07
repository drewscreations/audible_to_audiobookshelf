import type { ABSLibraryItem, AudibleAggregateDay } from "./types";

export interface MatchResult {
  matched: Array<{ day: AudibleAggregateDay; item: ABSLibraryItem }>;
  unmatched: AudibleAggregateDay[];
  matchedAsins: number;
  unmatchedAsins: number;
}

/**
 * Build an ASIN -> ABSLibraryItem index from library items.
 * Port of Python `build_asin_index()`.
 */
export function buildAsinIndex(
  items: ABSLibraryItem[]
): Map<string, ABSLibraryItem> {
  const index = new Map<string, ABSLibraryItem>();
  for (const item of items) {
    const asin = item.media?.metadata?.asin?.trim();
    if (asin && !index.has(asin)) {
      index.set(asin, item);
    }
  }
  return index;
}

/**
 * Match aggregated Audible days to ABS items by ASIN.
 */
export function matchDaysToItems(
  days: AudibleAggregateDay[],
  asinIndex: Map<string, ABSLibraryItem>
): MatchResult {
  const matched: Array<{ day: AudibleAggregateDay; item: ABSLibraryItem }> = [];
  const unmatched: AudibleAggregateDay[] = [];

  const matchedAsins = new Set<string>();
  const unmatchedAsins = new Set<string>();

  for (const day of days) {
    const item = asinIndex.get(day.asin);
    if (item) {
      matched.push({ day, item });
      matchedAsins.add(day.asin);
    } else {
      unmatched.push(day);
      unmatchedAsins.add(day.asin);
    }
  }

  return {
    matched,
    unmatched,
    matchedAsins: matchedAsins.size,
    unmatchedAsins: unmatchedAsins.size,
  };
}
