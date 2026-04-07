import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPORTS_DIR = join(process.cwd(), "data", "reports");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const path = join(REPORTS_DIR, `${id}.json`);
    if (!existsSync(path)) {
      return NextResponse.json({ ok: false, error: "Report not found" }, { status: 404 });
    }
    const raw = readFileSync(path, "utf-8");
    return NextResponse.json({ ok: true, data: JSON.parse(raw) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
