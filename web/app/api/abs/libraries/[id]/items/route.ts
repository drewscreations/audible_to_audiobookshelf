import { NextResponse } from "next/server";
import { createABSClient } from "@/lib/abs-client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const user = url.searchParams.get("user") || undefined;
    const client = createABSClient(user);
    const items = await client.libraryItems(id);
    return NextResponse.json({ ok: true, data: items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
