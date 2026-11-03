import { NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getNcmById,
  NcmNotFoundError,
  NcmValidationError,
  updateNcm,
} from "@/lib/documents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseNcmPatch(body: unknown): { code: string; description: string } {
  if (!body || typeof body !== "object") {
    throw new NcmValidationError("Informe os dados da NCM");
  }

  const row = body as Record<string, unknown>;
  if (typeof row.code !== "string") {
    throw new NcmValidationError("Código é obrigatório");
  }
  if (typeof row.description !== "string") {
    throw new NcmValidationError("Descrição é obrigatória");
  }

  return { code: row.code, description: row.description };
}

const log = createLogger("api/ncms/[id]");

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const ncm = await getNcmById(auth.tenantId, id);
    return NextResponse.json(ncm);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof NcmNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("request_failed", { error });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao carregar NCM",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode alterar NCM" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const patch = parseNcmPatch(body);

    const ncm = await updateNcm(auth.tenantId, id, patch);
    return NextResponse.json({ ok: true, ncm });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof NcmNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof NcmValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    log.error("request_failed", { error });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao atualizar NCM",
      },
      { status: 500 },
    );
  }
}
