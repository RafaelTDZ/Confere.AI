import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getPartyById,
  deleteParty,
  parsePartyAddress,
  PartyNotFoundError,
  PartyValidationError,
  updateParty,
  type PartyAddress,
} from "@/lib/documents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parsePartyPatch(body: unknown): {
  name: string;
  cnpj: string;
  address: PartyAddress;
} {
  if (!body || typeof body !== "object") {
    throw new PartyValidationError("Informe os dados da empresa");
  }

  const row = body as Record<string, unknown>;
  if (typeof row.name !== "string") {
    throw new PartyValidationError("Nome é obrigatório");
  }
  if (typeof row.cnpj !== "string") {
    throw new PartyValidationError("CNPJ é obrigatório");
  }

  return {
    name: row.name,
    cnpj: row.cnpj,
    address: parsePartyAddress(row.address),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const party = await getPartyById(auth.tenantId, id);
    return NextResponse.json(party);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof PartyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[api/parties GET id]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar empresa",
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
        { error: "Perfil viewer não pode alterar empresas" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const patch = parsePartyPatch(body);

    const party = await updateParty(auth.tenantId, id, patch);
    return NextResponse.json({ ok: true, party });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof PartyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PartyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[api/parties PATCH]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao atualizar empresa",
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
        { error: "Perfil viewer não pode excluir empresas" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    await deleteParty(auth.tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof PartyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[api/parties DELETE id]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir empresa" },
      { status: 500 },
    );
  }
}
