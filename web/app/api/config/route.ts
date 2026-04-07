import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";

export async function GET() {
  try {
    const config = loadConfig();
    // Redact tokens for client — only send user names
    const safeConfig = {
      ...config,
      tokens: Object.fromEntries(
        Object.keys(config.tokens).map((k) => [k, "***"])
      ),
      tokenUsers: Object.keys(config.tokens),
    };
    return NextResponse.json({ ok: true, data: safeConfig });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const updated = saveConfig(body);
    const safeConfig = {
      ...updated,
      tokens: Object.fromEntries(
        Object.keys(updated.tokens).map((k) => [k, "***"])
      ),
      tokenUsers: Object.keys(updated.tokens),
    };
    return NextResponse.json({ ok: true, data: safeConfig });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
