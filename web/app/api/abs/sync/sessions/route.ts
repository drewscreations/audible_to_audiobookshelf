import { NextResponse } from "next/server";
import { createABSClient } from "@/lib/abs-client";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessions = body.sessions;
    const user: string | undefined = body.user;

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No sessions provided" },
        { status: 400 }
      );
    }

    const client = createABSClient(user);
    const result = await client.syncSessions(sessions);

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
