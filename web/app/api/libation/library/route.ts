import { NextResponse } from "next/server";
import { getLibationBooks, isLibationAvailable } from "@/lib/libation-db";

export async function GET() {
  try {
    if (!isLibationAvailable()) {
      return NextResponse.json(
        { ok: false, error: "Libation database not found" },
        { status: 404 }
      );
    }
    const books = getLibationBooks();
    return NextResponse.json({ ok: true, data: books });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
