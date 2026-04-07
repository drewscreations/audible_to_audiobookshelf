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
    const coverRes = await client.getCover(id);

    if (!coverRes.ok) {
      return new Response(null, { status: 404 });
    }

    const body = coverRes.body;
    const contentType = coverRes.headers.get("content-type") || "image/jpeg";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
