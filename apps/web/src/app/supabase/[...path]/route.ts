import { type NextRequest, NextResponse } from "next/server";

const supabaseUpstream =
  process.env.SUPABASE_INTERNAL_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "http://127.0.0.1:54321";

export const dynamic = "force-dynamic";

/** Headers que quebram o browser quando repassados do fetch do Node (gzip/chunked/etc.). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  // Cloudflare / upstream cookies não devem vazar para o origin do app
  "set-cookie",
]);

type RouteContext = { params: Promise<{ path: string[] }> };

function filterRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length") {
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

function filterResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of upstream.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const upstreamUrl = new URL(
    path.join("/"),
    supabaseUpstream.endsWith("/") ? supabaseUpstream : `${supabaseUpstream}/`,
  );
  upstreamUrl.search = request.nextUrl.search;

  const headers = filterRequestHeaders(request);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    // Bufferiza o body: streaming + duplex é frágil em alguns runtimes/túneis.
    init.body = Buffer.from(await request.arrayBuffer());
  }

  const upstreamResponse = await fetch(upstreamUrl, init);
  const body = await upstreamResponse.arrayBuffer();

  return new NextResponse(body, {
    status: upstreamResponse.status,
    headers: filterResponseHeaders(upstreamResponse.headers),
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
