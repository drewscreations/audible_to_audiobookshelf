import { NextResponse } from "next/server";
import { createABSClient } from "@/lib/abs-client";
import { buildAsinIndex } from "@/lib/matching";

/**
 * POST /api/abs/match
 * Body: { asins: string[], libraryIds: string[] }
 * Returns: ASIN -> { itemId, libraryId, title, authorName, duration } mapping
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const asins: string[] = body.asins || [];
    const libraryIds: string[] = body.libraryIds || [];
    const user: string | undefined = body.user;

    const client = createABSClient(user);

    // Fetch items for all requested libraries
    const allItems = [];
    for (const libId of libraryIds) {
      const items = await client.libraryItems(libId);
      allItems.push(...items);
    }

    const asinIndex = buildAsinIndex(allItems);

    // Build response with only the requested ASINs
    const matches: Record<string, {
      itemId: string;
      libraryId: string;
      title: string;
      authorName: string;
      duration: number;
    }> = {};
    const unmatched: string[] = [];

    for (const asin of asins) {
      const item = asinIndex.get(asin);
      if (item) {
        matches[asin] = {
          itemId: item.id,
          libraryId: item.libraryId,
          title: item.media?.metadata?.title || "",
          authorName: item.media?.metadata?.authorName || "",
          duration: item.media?.duration || 0,
        };
      } else {
        unmatched.push(asin);
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        matches,
        unmatched,
        totalItems: allItems.length,
        matchedCount: Object.keys(matches).length,
        unmatchedCount: unmatched.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
