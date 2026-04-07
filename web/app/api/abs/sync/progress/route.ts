import { NextResponse } from "next/server";
import { createABSClient } from "@/lib/abs-client";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const updates = body.updates;
    const user: string | undefined = body.user;

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No updates provided" },
        { status: 400 }
      );
    }

    const client = createABSClient(user);
    const result = await client.updateProgress(updates);

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
