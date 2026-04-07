import { NextResponse } from "next/server";
import {
  getAccountStatus,
  refreshAllAccounts,
} from "@/lib/libation-auth";
import { isContainerRunning } from "@/lib/libation-exec";

/**
 * GET /api/libation/auth
 * Returns account status (token expiration, whether expired).
 */
export async function GET() {
  try {
    const running = await isContainerRunning().catch(() => false);
    if (!running) {
      return NextResponse.json(
        { ok: false, error: "Libation container not running" },
        { status: 503 }
      );
    }

    const accounts = await getAccountStatus();
    return NextResponse.json({ ok: true, data: { accounts } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/libation/auth
 * Refresh all Audible tokens using stored refresh tokens.
 */
export async function POST() {
  try {
    const running = await isContainerRunning().catch(() => false);
    if (!running) {
      return NextResponse.json(
        { ok: false, error: "Libation container not running" },
        { status: 503 }
      );
    }

    const result = await refreshAllAccounts();

    // Restart Libation container to pick up new tokens
    if (result.refreshed.length > 0) {
      const { libationScan } = await import("@/lib/libation-exec");
      // Don't scan yet — just signal success. User can scan separately.
      void libationScan; // suppress unused
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
