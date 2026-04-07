import { NextResponse } from "next/server";
import { libationScan } from "@/lib/libation-exec";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const accounts = body.accounts as string[] | undefined;
    const result = await libationScan(accounts);
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
