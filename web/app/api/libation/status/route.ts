import { NextResponse } from "next/server";
import { isContainerRunning, isPortainerAvailable } from "@/lib/libation-exec";
import { isLibationAvailable, getLibationStats } from "@/lib/libation-db";

export async function GET() {
  try {
    const [containerRunning, portainerAvailable, dbAvailable] = await Promise.all([
      isContainerRunning().catch(() => false),
      isPortainerAvailable().catch(() => false),
      Promise.resolve(isLibationAvailable()),
    ]);

    let stats = null;
    if (dbAvailable) {
      try {
        stats = getLibationStats();
      } catch {
        // DB might be locked or corrupted
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        containerRunning,
        portainerAvailable,
        dbAvailable,
        totalBooks: stats?.totalBooks ?? null,
        downloadedBooks: stats?.downloadedBooks ?? null,
        notDownloaded: stats?.notDownloaded ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
