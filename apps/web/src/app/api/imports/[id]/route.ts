import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getImportDetail,
  deleteImportRecord,
  ImportConflictError,
  ImportNotFoundError,
  ImportValidationError,
  updateImportRecord,
} from "@/lib/documents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseImportPatch(body: unknown): {
  referenceNumber: string;
  supplierName?: string | null;
} {
  if (!body || typeof body !== "object") {
    throw new ImportValidationError("Informe os dados da importação");
  }

  const row = body as Record<string, unknown>;
  if (typeof row.referenceNumber !== "string") {
    throw new ImportValidationError("Referência inválida");
  }

  const patch: {
    referenceNumber: string;
    supplierName?: string | null;
  } = { referenceNumber: row.referenceNumber };

  if ("supplierName" in row) {
    if (row.supplierName !== null && typeof row.supplierName !== "string") {
      throw new ImportValidationError("Fornecedor inválido");
    }
    patch.supplierName = row.supplierName;
  }

  return patch;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const detail = await getImportDetail(auth.tenantId, id);
    return NextResponse.json(detail);
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
    console.error("[api/imports GET id]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar importação",
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
        { error: "Perfil viewer não pode alterar importações" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const patch = parseImportPatch(body);
    const detail = await updateImportRecord(auth.tenantId, id, patch);

    return NextResponse.json({ ok: true, import: detail });
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
    if (error instanceof ImportValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ImportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[api/imports PATCH]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar importação",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode remover importações" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    await deleteImportRecord(auth.tenantId, id);
    return NextResponse.json({ ok: true });
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
    console.error("[api/imports DELETE id]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao remover importação",
      },
      { status: 500 },
    );
  }
}
