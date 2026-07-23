import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/sync-engine";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: getSettings() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** Update auto-sync settings: { enabled?, intervalMinutes?, syncProgress?, accountMap? } */
export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      intervalMinutes?: number;
      syncProgress?: boolean;
      accountMap?: Record<string, unknown>;
    };
    let accountMap: Record<string, string> | undefined;
    if (body.accountMap && typeof body.accountMap === "object") {
      accountMap = Object.fromEntries(
        Object.entries(body.accountMap).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
    }
    const settings = updateSettings({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      intervalMinutes:
        typeof body.intervalMinutes === "number" ? body.intervalMinutes : undefined,
      syncProgress:
        typeof body.syncProgress === "boolean" ? body.syncProgress : undefined,
      accountMap,
    });
    return NextResponse.json({ ok: true, data: settings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
