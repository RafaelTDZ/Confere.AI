import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  createNcm,
  listTenantNcms,
  NcmValidationError,
} from "@/lib/documents";

function parseNcmBody(body: unknown): { code: string; description: string } {
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

export async function GET() {
  try {
    const auth = await getAuthContext();
    const page = await listTenantNcms(auth.tenantId);
    return NextResponse.json({
      ncms: page.rows,
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    console.error("[api/ncms GET]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao listar NCMs",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode cadastrar NCM" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    const payload = parseNcmBody(body);
    const ncm = await createNcm(auth.tenantId, payload);
    return NextResponse.json({ ok: true, ncm }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof NcmValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[api/ncms POST]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao cadastrar NCM",
      },
      { status: 500 },
    );
  }
}
