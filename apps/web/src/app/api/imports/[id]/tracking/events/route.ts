import { NextResponse } from "next/server";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { ImportNotFoundError } from "@/lib/documents";
import {
  addManualTrackingEvent,
  getTrackingForImport,
} from "@/lib/tracking/service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await getAuthContext();
    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode lançar eventos de rastreio" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) {
      return NextResponse.json({ error: "Informe o evento" }, { status: 400 });
    }

    const eventAt = readString(body.eventAt);
    const description = readString(body.description);
    if (!eventAt || !description) {
      return NextResponse.json(
        { error: "Data e descrição são obrigatórias" },
        { status: 400 },
      );
    }

    const { id } = await context.params;

    await addManualTrackingEvent({
      tenantId: auth.tenantId,
      importId: id,
      userId: auth.userId ?? null,
      event: {
        eventAt,
        description,
        location: readString(body.location),
        status: readString(body.status),
        containerNumber: readString(body.containerNumber),
      },
    });

    const tracking = await getTrackingForImport(auth.tenantId, id);
    return NextResponse.json({ ok: true, tracking });
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
    console.error("[api/imports/tracking/events POST]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao salvar evento",
      },
      { status: 400 },
    );
  }
}
