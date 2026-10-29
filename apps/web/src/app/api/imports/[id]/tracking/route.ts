import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { ImportNotFoundError } from "@/lib/documents";
import { getTrackingForImport } from "@/lib/tracking/service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    const { id } = await context.params;
    const tracking = await getTrackingForImport(auth.tenantId, id);
    return NextResponse.json(tracking);
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
    console.error("[api/imports/tracking GET]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar rastreio",
      },
      { status: 500 },
    );
  }
}
