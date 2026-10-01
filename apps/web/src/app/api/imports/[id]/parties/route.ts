import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getImportPartiesState,
  ImportNotFoundError,
  parsePartyAddress,
  PartyValidationError,
  registerImportParties,
  type PartyRole,
  type PendingParty,
} from "@/lib/documents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parsePartyRoles(value: unknown): PartyRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (role): role is PartyRole => role === "consignee" || role === "notify",
  );
}

function parsePendingParties(body: unknown): PendingParty[] {
  if (!body || typeof body !== "object" || !("parties" in body)) {
    throw new PartyValidationError("Informe as partes para cadastrar");
  }

  const parties = (body as { parties: unknown }).parties;
  if (!Array.isArray(parties) || parties.length === 0) {
    throw new PartyValidationError("Informe ao menos uma parte para cadastrar");
  }

  return parties.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new PartyValidationError(`Parte ${index + 1} inválida`);
    }
    const row = item as Record<string, unknown>;
    return {
      roles: parsePartyRoles(row.roles),
      name: typeof row.name === "string" ? row.name : null,
      cnpj: typeof row.cnpj === "string" ? row.cnpj : null,
      address: parsePartyAddress(row.address),
    };
  });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const state = await getImportPartiesState(auth.tenantId, id);
    return NextResponse.json(state);
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
    console.error("[api/imports/parties GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar partes" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode cadastrar partes" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const parties = parsePendingParties(body);

    await registerImportParties({
      tenantId: auth.tenantId,
      importId: id,
      parties,
    });

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
    if (error instanceof PartyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[api/imports/parties POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao cadastrar partes" },
      { status: 500 },
    );
  }
}
