import { NextResponse } from "next/server";
import { syncListeningProgress } from "@/lib/progress-sync";
import { getAudibleAuths } from "@/lib/audible-api";
import { getSettings } from "@/lib/sync-engine";
import { loadConfig } from "@/lib/config";

/** Audible accounts + current ABS-user mapping (for the settings UI) */
export async function GET() {
  try {
    const config = loadConfig();
    const settings = getSettings();
    const auths = await getAudibleAuths();
    return NextResponse.json({
      ok: true,
      data: {
        accounts: auths.map((a) => ({
          accountId: a.accountId,
          accountName: a.accountName,
          locale: a.locale,
        })),
        accountMap: settings.accountMap || {},
        tokenUsers: Object.keys(config.tokens),
        syncProgress: settings.syncProgress !== false,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * Run a listening-progress sync now. Body: { dryRun?: boolean, force?: boolean }
 * Manual runs are full syncs; pass force:false to exercise the stats gate
 * the scheduler uses (diagnostics).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
      force?: boolean;
    };
    const summary = await syncListeningProgress({
      dryRun: body.dryRun === true,
      force: body.force !== false,
    });
    return NextResponse.json({ ok: true, data: summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
