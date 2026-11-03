import { NextResponse, after } from "next/server";
import { AiConfigError } from "@/lib/ai";
import {
  assertAllowedFile,
  normalizeMediaType,
  sha256Hex,
} from "@/lib/ai/file-utils";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  getMonthlyTokenUsage,
  ImportNotFoundError,
  ImportValidationError,
  persistAiLog,
} from "@/lib/documents";
import { createAiJob } from "@/lib/documents/ai-jobs";
import { processAiJobById } from "@/lib/documents/ai-worker";
import {
  consumeRateLimit,
  getAnalyzeRateLimit,
  getAnalyzeRateWindowSeconds,
  getMonthlyTokenQuota,
} from "@/lib/security/rate-limit";
import { createLogger, runWithLogContext } from "@/lib/observability/logger";

export const runtime = "nodejs";
// Hobby com Fluid compute permite até 300s; o worker roda no `after()` da
// própria request e já medimos análises de ~290s (invoice + packing list).
export const maxDuration = 300;

const log = createLogger("api/ai/analyze");

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
  let userIdForLog: string | null = null;
  let importIdForLog: string | undefined;
  let jobIdForLog: string | undefined;
  const modelId = "unknown";

  try {
    const auth = await getAuthContext();
    tenantIdForLog = auth.tenantId;
    userIdForLog = auth.userId;

    if (auth.role === "viewer") {
      log.warn("request_rejected", {
        tenantId: auth.tenantId,
        userId: auth.userId,
        reason: "viewer_role",
        status: 403,
      });
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
        log.warn("rate_limit_exceeded", {
          tenantId: auth.tenantId,
          userId: auth.userId,
          limit: getAnalyzeRateLimit(),
          windowSeconds: getAnalyzeRateWindowSeconds(),
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
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
      log.warn("rate_limit_unavailable", {
        tenantId: auth.tenantId,
        error,
      });
    }

    try {
      const usage = await getMonthlyTokenUsage(auth.tenantId);
      const quota = getMonthlyTokenQuota();

      if (usage >= quota) {
        log.warn("monthly_quota_exceeded", {
          tenantId: auth.tenantId,
          userId: auth.userId,
          usage,
          quota,
          retryAfterSeconds: getSecondsUntilNextMonthUtc(),
        });
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
      log.warn("quota_check_unavailable", {
        tenantId: auth.tenantId,
        error,
      });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      log.warn("request_rejected", {
        tenantId: auth.tenantId,
        userId: auth.userId,
        reason: "missing_file",
        status: 400,
      });
      return NextResponse.json(
        { error: "Campo file é obrigatório" },
        { status: 400 },
      );
    }

    const importId = parseOptionalImportId(form.get("importId"));
    importIdForLog = importId;

    const filename = file.name || "documento";
    const mediaType = normalizeMediaType(file.type, filename);
    const bytes = new Uint8Array(await file.arrayBuffer());
    assertAllowedFile(bytes.byteLength, mediaType);
    const digest = sha256Hex(bytes);

    const job = await createAiJob({
      tenantId: auth.tenantId,
      userId: auth.userId,
      importId,
      file: { bytes, filename, mediaType, digest },
    });
    jobIdForLog = job.id;

    log.info("job_enqueued", {
      tenantId: auth.tenantId,
      userId: auth.userId,
      jobId: job.id,
      importId: job.import_id ?? undefined,
      filename,
      mediaType,
      bytes: bytes.byteLength,
      sha256: digest.slice(0, 12),
      elapsedMs: Date.now() - started,
    });

    // Responde 202 imediatamente; o pipeline continua após a resposta.
    after(async () => {
      const workerContext = {
        tenantId: auth.tenantId,
        userId: auth.userId,
        jobId: job.id,
        importId: job.import_id ?? undefined,
        source: "analyze_after",
      };
      try {
        await runWithLogContext(workerContext, () =>
          processAiJobById(job.id),
        );
      } catch (error) {
        log.error("worker_failed", {
          ...workerContext,
          elapsedMs: Date.now() - started,
          error,
        });
      }
    });

    return NextResponse.json(
      { jobId: job.id, importId: job.import_id, status: job.status },
      { status: 202 },
    );
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

    log.error("request_failed", {
      tenantId: tenantIdForLog,
      userId: userIdForLog,
      jobId: jobIdForLog,
      importId: importIdForLog,
      elapsedMs: Date.now() - started,
      error,
    });
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
