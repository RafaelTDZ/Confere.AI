import { NextResponse } from "next/server";
import { OpenRouterConfigError } from "@/lib/ai";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import { persistAiLog, runAnalyzePipeline } from "@/lib/documents";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const started = Date.now();
  let tenantIdForLog: string | null = null;
  let modelId = "unknown";

  try {
    const auth = await getAuthContext();
    tenantIdForLog = auth.tenantId;

    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode enviar documentos" },
        { status: 403 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Campo file é obrigatório" },
        { status: 400 },
      );
    }

    const result = await runAnalyzePipeline({
      tenantId: auth.tenantId,
      userId: auth.userId,
      file,
      startedAt: started,
    });
    modelId = result.model;

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof OpenRouterConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const message =
      error instanceof Error ? error.message : "Falha ao analisar documento";

    if (
      message.includes("SUPABASE_SERVICE_ROLE_KEY") ||
      message.includes("SUPABASE_SECRET_KEY")
    ) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    if (
      message.includes("não suportado") ||
      message.includes("Arquivo") ||
      message.includes("obrigatório")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (/failed to parse/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Não foi possível ler o PDF. Tente reenviar, ou use PNG/JPG do documento.",
        },
        { status: 422 },
      );
    }

    console.error("[api/ai/analyze]", error);
    if (tenantIdForLog) {
      await persistAiLog({
        tenantId: tenantIdForLog,
        capability: "analyze",
        model: modelId,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        status: "error",
        errorMessage: message,
      });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
