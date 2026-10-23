import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  consumeRateLimit,
  getCheckEmailRateLimit,
  getCheckEmailRateWindowSeconds,
} from "@/lib/security/rate-limit";
import { createSupabasePublicClient } from "@/lib/supabase/public-client";

export const runtime = "nodejs";

/** IP do cliente atrás do proxy; nunca é persistido, só usado no hash. */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedIp = forwarded?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export async function POST(request: NextRequest) {
  try {
    try {
      const ip = getClientIp(request);
      const ipHash = createHash("sha256").update(ip).digest("hex");
      const rateLimit = await consumeRateLimit({
        bucket: `check-email:ip:${ipHash}`,
        limit: getCheckEmailRateLimit(),
        windowSeconds: getCheckEmailRateWindowSeconds(),
      });

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error:
              "Muitas verificações de email. Tente novamente mais tarde.",
          },
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        );
      }
    } catch (error) {
      // Fail-open: indisponibilidade do rate limiter não bloqueia a verificação.
      console.error("[auth/check-email] rate limit indisponível", error);
    }

    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email é obrigatório" },
        { status: 400 },
      );
    }

    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

    // Sem cookies: JWT legado/local no browser não pode contaminar esta RPC.
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.rpc("email_registered", {
      p_email: normalized,
    });

    if (error) {
      console.error("[auth/check-email] RPC error:", error);
      return NextResponse.json(
        { error: "Erro ao verificar email" },
        { status: 500 },
      );
    }

    return NextResponse.json({ exists: Boolean(data) });
  } catch (error) {
    console.error("[auth/check-email] Error:", error);
    return NextResponse.json(
      { error: "Erro ao verificar email" },
      { status: 500 },
    );
  }
}
