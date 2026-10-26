import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { getPartyById, PartyNotFoundError } from "@/lib/documents";
import { setDefaultConsignee } from "@/lib/documents/consignee-settings";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * `undefined` = inválido, `null` = remover o padrão e string = party escolhida.
 * Só aceita UUID ou `null` explícito para não gravar lixo na FK.
 */
function parsePartyId(body: unknown): string | null | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const { partyId } = body as { partyId?: unknown };
  if (partyId === null) return null;
  if (typeof partyId === "string" && UUID_RE.test(partyId)) return partyId;
  return undefined;
}

/** Define (ou remove, com `partyId: null`) o consignee padrão do tenant. */
export async function PUT(request: Request) {
  try {
    const auth = await getAuthContext();
    if (auth.role !== "owner" && auth.role !== "admin") {
      return NextResponse.json(
        { error: "Apenas owner/admin podem definir o consignee padrão" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    const partyId = parsePartyId(body);
    if (partyId === undefined) {
      return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
    }

    if (partyId !== null) {
      try {
        // Leitura via RLS: garante que a empresa pertence ao tenant do usuário.
        await getPartyById(auth.tenantId, partyId);
      } catch (error) {
        if (error instanceof PartyNotFoundError) {
          return NextResponse.json(
            { error: "Empresa não encontrada" },
            { status: 400 },
          );
        }
        throw error;
      }
    }

    await setDefaultConsignee(auth.tenantId, partyId);
    return NextResponse.json({ ok: true, partyId });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    console.error("[api/settings/consignee] PUT", error);
    return NextResponse.json(
      { error: "Falha ao salvar consignee padrão" },
      { status: 500 },
    );
  }
}
