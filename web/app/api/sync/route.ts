import { NextResponse } from "next/server";
import { getSyncStatus, runSyncCycle } from "@/lib/sync-engine";

/** Auto-sync status + recent activity */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: getSyncStatus() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * Run a sync cycle now. Fast outcomes (skips, nothing new) are returned
 * directly; if the cycle is still going after a few seconds (downloading),
 * respond immediately and let the client poll GET for progress.
 */
export async function POST() {
  try {
    const cyclePromise = runSyncCycle("manual").catch((e) => {
      console.error("[auto-sync] manual cycle crashed:", e);
      return null;
    });
    const quick = await Promise.race([
      cyclePromise,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ]);
    if (quick !== undefined) {
      return NextResponse.json({ ok: true, data: { result: quick, running: false } });
    }
    return NextResponse.json({ ok: true, data: { result: null, running: true } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
