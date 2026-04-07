import { NextResponse } from "next/server";
import { getLibationBookByAsin, isLibationAvailable } from "@/lib/libation-db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asin: string }> }
) {
  try {
    const { asin } = await params;
    if (!isLibationAvailable()) {
      return NextResponse.json(
        { ok: false, error: "Libation database not found" },
        { status: 404 }
      );
    }
    const book = getLibationBookByAsin(asin);
    if (!book) {
      return NextResponse.json(
        { ok: false, error: "Book not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, data: book });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
