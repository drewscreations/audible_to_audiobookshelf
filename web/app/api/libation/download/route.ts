import { NextResponse } from "next/server";
import { libationDownload } from "@/lib/libation-exec";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await libationDownload({
      asin: body.asin,
      force: body.force,
      pdfOnly: body.pdfOnly,
    });
    return NextResponse.json({
      ok: true,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
