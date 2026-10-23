import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
};

const DEFAULT_ANALYZE_RATE_LIMIT = 30;
const DEFAULT_ANALYZE_RATE_WINDOW_SECONDS = 3600;
const DEFAULT_CHECK_EMAIL_RATE_LIMIT = 10;
const DEFAULT_CHECK_EMAIL_RATE_WINDOW_SECONDS = 60;
const DEFAULT_MONTHLY_TOKEN_QUOTA = 10_000_000;

/** Lê um inteiro positivo do env; qualquer valor inválido cai no default. */
function readPositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Limite de análises por tenant na janela configurada. */
export function getAnalyzeRateLimit(): number {
  return readPositiveInt(
    process.env.AI_ANALYZE_RATE_LIMIT,
    DEFAULT_ANALYZE_RATE_LIMIT,
  );
}

/** Duração da janela do rate limit de análises, em segundos. */
export function getAnalyzeRateWindowSeconds(): number {
  return readPositiveInt(
    process.env.AI_ANALYZE_RATE_WINDOW_SECONDS,
    DEFAULT_ANALYZE_RATE_WINDOW_SECONDS,
  );
}

/** Limite de verificações de email por IP na janela configurada. */
export function getCheckEmailRateLimit(): number {
  return readPositiveInt(
    process.env.CHECK_EMAIL_RATE_LIMIT,
    DEFAULT_CHECK_EMAIL_RATE_LIMIT,
  );
}

/** Duração da janela do rate limit de verificação de email, em segundos. */
export function getCheckEmailRateWindowSeconds(): number {
  return readPositiveInt(
    process.env.CHECK_EMAIL_RATE_WINDOW_SECONDS,
    DEFAULT_CHECK_EMAIL_RATE_WINDOW_SECONDS,
  );
}

/** Quota mensal de tokens de IA por tenant. */
export function getMonthlyTokenQuota(): number {
  return readPositiveInt(
    process.env.AI_MONTHLY_TOKEN_QUOTA,
    DEFAULT_MONTHLY_TOKEN_QUOTA,
  );
}

type ConsumeRateLimitRow = {
  allowed: boolean | null;
  remaining: number | null;
  reset_at: string | null;
};

/**
 * Consome uma unidade do bucket no Postgres (janela fixa) e informa se a
 * requisição pode seguir. Lança erro quando o RPC falha — o chamador decide
 * entre bloquear (fail-closed) ou seguir o fluxo (fail-open).
 */
export async function consumeRateLimit(params: {
  bucket: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_bucket: params.bucket,
    p_window_seconds: params.windowSeconds,
    p_limit: params.limit,
  });

  if (error) {
    throw new Error(
      `Falha ao verificar o rate limit (${params.bucket}): ${error.message}`,
    );
  }

  const row = ((data ?? []) as ConsumeRateLimitRow[])[0];
  if (!row) {
    throw new Error(
      `Falha ao verificar o rate limit (${params.bucket}): resposta vazia`,
    );
  }

  if (
    typeof row.allowed !== "boolean" ||
    typeof row.remaining !== "number" ||
    typeof row.reset_at !== "string"
  ) {
    throw new Error(
      `Falha ao verificar o rate limit (${params.bucket}): resposta inválida`,
    );
  }

  const resetAtMs = new Date(row.reset_at).getTime();
  if (Number.isNaN(resetAtMs)) {
    throw new Error(
      `Falha ao verificar o rate limit (${params.bucket}): reset_at inválido`,
    );
  }

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000)),
  };
}
