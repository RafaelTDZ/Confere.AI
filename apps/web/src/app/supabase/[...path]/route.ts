import { type NextRequest, NextResponse } from "next/server";

const supabaseUpstream =
  process.env.SUPABASE_INTERNAL_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "http://127.0.0.1:54321";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const upstreamUrl = new URL(
    path.join("/"),
    supabaseUpstream.endsWith("/") ? supabaseUpstream : `${supabaseUpstream}/`,
  );
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstreamResponse = await fetch(upstreamUrl, init);

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
