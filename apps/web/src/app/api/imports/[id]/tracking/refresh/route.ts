import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { ImportNotFoundError } from "@/lib/documents";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  getTrackingForImport,
  refreshTrackingForImport,
} from "@/lib/tracking/service";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("api/tracking/refresh");

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Uma consulta ao armador leva ~13s, mas o pior caso do Firecrawl é ~65s
 * (60s de scrape + 5s de abort) — em Maersk (stealth + 18s) e Hapag (formulário
 * AEM) a function precisa de folga para não morrer no meio e deixar o job
 * `running`. A importação tem um único alvo, então 120s cobre o pior caso.
 */
export const maxDuration = 120;

const REFRESH_LIMIT = 10;
const REFRESH_WINDOW_SECONDS = 60 * 60;

export async function POST(_request: Request, context: RouteContext) {
  let importIdForLog: string | undefined;
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      log.warn("request_rejected", {
        tenantId: auth.tenantId,
        reason: "viewer_role",
        status: 403,
      });
      return NextResponse.json(
        { error: "Perfil viewer não pode atualizar rastreios" },
        { status: 403 },
      );
    }

    const limit = await consumeRateLimit({
      bucket: `tracking:refresh:${auth.tenantId}`,
      limit: REFRESH_LIMIT,
      windowSeconds: REFRESH_WINDOW_SECONDS,
    });

    if (!limit.allowed) {
      log.warn("rate_limit_exceeded", {
        tenantId: auth.tenantId,
        limit: REFRESH_LIMIT,
        windowSeconds: REFRESH_WINDOW_SECONDS,
        retryAfterSeconds: limit.retryAfterSeconds,
      });
      return NextResponse.json(
        {
          error: "Muitas atualizações de rastreio. Tente novamente em instantes.",
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const { id } = await context.params;
    importIdForLog = id;
    const result = await refreshTrackingForImport({
      tenantId: auth.tenantId,
      importId: id,
      force: true,
    });
    const tracking = await getTrackingForImport(auth.tenantId, id);

    log.info("refresh_finished", {
      tenantId: auth.tenantId,
      importId: id,
      ...result,
      shipments: tracking.shipments.length,
      events: tracking.events.length,
      creditsUsedThisMonth: tracking.creditsUsedThisMonth,
    });

    // `skipped: "cooldown"` + `retryAfterSeconds` e `skipped: "arrived"` são
    // respostas normais (200): nenhum crédito foi gasto (consulta recente
    // reaproveitada / embarque já chegou e o rastreio automático acabou).
    return NextResponse.json({ ok: true, ...result, tracking });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof ImportNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("refresh_failed", {
      importId: importIdForLog,
      error,
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao atualizar rastreio",
      },
      { status: 500 },
    );
  }
}
