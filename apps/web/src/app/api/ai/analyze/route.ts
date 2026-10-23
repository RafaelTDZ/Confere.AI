import { NextResponse } from "next/server";
import { AiConfigError } from "@/lib/ai";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getMonthlyTokenUsage,
  ImportNotFoundError,
  ImportValidationError,
  persistAiLog,
  runAnalyzePipeline,
} from "@/lib/documents";
import {
  consumeRateLimit,
  getAnalyzeRateLimit,
  getAnalyzeRateWindowSeconds,
  getMonthlyTokenQuota,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const IMPORT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Segundos até a virada do mês seguinte em UTC (quando a quota reinicia). */
function getSecondsUntilNextMonthUtc(now = new Date()): number {
  const nextMonthMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1,
  );
  return Math.max(0, Math.ceil((nextMonthMs - now.getTime()) / 1000));
}

function parseOptionalImportId(
  value: FormDataEntryValue | null,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!IMPORT_ID_RE.test(trimmed)) {
    throw new ImportValidationError("Importação inválida");
  }
  return trimmed;
}

export async function POST(request: Request) {
  const started = Date.now();
  let tenantIdForLog: string | null = null;
  let importIdForLog: string | undefined;
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

    try {
      const rateLimit = await consumeRateLimit({
        bucket: `analyze:tenant:${auth.tenantId}`,
        limit: getAnalyzeRateLimit(),
        windowSeconds: getAnalyzeRateWindowSeconds(),
      });

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error: "Muitas análises em pouco tempo. Tente novamente mais tarde.",
          },
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        );
      }
    } catch (error) {
      // Fail-open: indisponibilidade do rate limiter não bloqueia a análise.
      console.error("[api/ai/analyze] rate limit indisponível", error);
    }

    try {
      const usage = await getMonthlyTokenUsage(auth.tenantId);
      const quota = getMonthlyTokenQuota();

      if (usage >= quota) {
        return NextResponse.json(
          {
            error:
              "Quota mensal de IA atingida. Tente novamente no próximo mês.",
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(getSecondsUntilNextMonthUtc()),
            },
          },
        );
      }
    } catch (error) {
      // Fail-open: falha ao calcular o uso não bloqueia a análise.
      console.error("[api/ai/analyze] quota indisponível", error);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Campo file é obrigatório" },
        { status: 400 },
      );
    }

    const importId = parseOptionalImportId(form.get("importId"));
    importIdForLog = importId;

    const result = await runAnalyzePipeline({
      tenantId: auth.tenantId,
      userId: auth.userId,
      file,
      startedAt: started,
      importId,
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
    if (error instanceof ImportNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ImportValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AiConfigError) {
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
        importId: importIdForLog,
      });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
