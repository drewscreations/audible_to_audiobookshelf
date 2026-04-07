import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const REPORTS_DIR = join(process.cwd(), "data", "reports");

function ensureDir() {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

export async function GET() {
  try {
    ensureDir();
    const files = readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    const reports = files.map((f) => {
      const raw = readFileSync(join(REPORTS_DIR, f), "utf-8");
      const report = JSON.parse(raw);
      return { id: f.replace(".json", ""), ...report };
    });

    return NextResponse.json({ ok: true, data: reports });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    ensureDir();
    const body = await request.json();
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(REPORTS_DIR, `${id}.json`);
    writeFileSync(path, JSON.stringify({ ...body, id, timestamp: new Date().toISOString() }, null, 2));
    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
