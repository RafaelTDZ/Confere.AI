import { NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { ImportNotFoundError } from "@/lib/documents";
import { getTrackingInProgress } from "@/lib/tracking/service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const log = createLogger("api/tracking-status");

/**
 * Estado leve da consulta ao armador, para o botão "Rastrear" (polling curto).
 * Não devolve eventos nem shipments: só se há job `queued`/`running`.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const status = await getTrackingInProgress({
      tenantId: auth.tenantId,
      importId: id,
    });
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
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
    log.error("request_failed", { error });
    return NextResponse.json(
      { error: "Falha ao consultar o rastreio" },
      { status: 500 },
    );
  }
}
