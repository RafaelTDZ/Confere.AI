import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { listTenantParties } from "@/lib/documents";

export async function GET() {
  try {
    const auth = await getAuthContext();
    const parties = await listTenantParties(auth.tenantId);
    return NextResponse.json({ parties });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    console.error("[api/parties GET]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao listar empresas",
      },
      { status: 500 },
    );
  }
}
