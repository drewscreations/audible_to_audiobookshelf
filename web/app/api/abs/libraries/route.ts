import { NextResponse } from "next/server";
import { createABSClient } from "@/lib/abs-client";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const user = url.searchParams.get("user") || undefined;
    const client = createABSClient(user);
    const libraries = await client.libraries();
    return NextResponse.json({ ok: true, data: libraries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
