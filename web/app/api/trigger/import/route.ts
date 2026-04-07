import { NextResponse } from "next/server";

/**
 * POST /api/trigger/import
 * External trigger endpoint for scheduled imports.
 * Body: { user?: string, since?: string, libraries?: string[] }
 *
 * This endpoint is designed to be called by external schedulers like
 * Windows Task Scheduler or cron:
 *   curl -X POST http://localhost:3001/api/trigger/import
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { user, since } = body;

    // This is a placeholder for the full automated import pipeline.
    // When Libation is set up, this would:
    // 1. Optionally trigger libationcli scan + liberate
    // 2. Parse a pre-configured CSV path
    // 3. Match ASINs and sync sessions/progress

    return NextResponse.json({
      ok: true,
      data: {
        message: "Trigger endpoint ready. Full automation pending Libation + CSV path configuration.",
        user: user || "default",
        since: since || "all",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
