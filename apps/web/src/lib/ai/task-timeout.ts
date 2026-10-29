import "server-only";

/**
 * Orçamento por chamada de IA.
 *
 * Sem isso, uma chamada travada consome todo o `maxDuration` da função — já
 * medimos `extract_invoice` levando 277s — e o job morre sem marcar falha. O
 * timeout aborta a chamada e tenta mais uma vez antes de desistir com uma
 * mensagem acionável.
 */

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_RETRIES = 1;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_RETRIES = 3;

function parseEnvInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

/** Tempo máximo de uma tentativa (`AI_TASK_TIMEOUT_MS`, padrão 90s). */
export function aiTaskTimeoutMs(): number {
  return parseEnvInt(
    "AI_TASK_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
}

/** Retentativas após timeout (`AI_TASK_RETRIES`, padrão 1). */
export function aiTaskRetries(): number {
  return parseEnvInt("AI_TASK_RETRIES", DEFAULT_RETRIES, 0, MAX_RETRIES);
}

/** A IA não respondeu dentro do orçamento, mesmo após as retentativas. */
export class AiTaskTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(
    label: string,
    timeoutMs: number,
    attempts: number,
    options?: { cause?: unknown },
  ) {
    const seconds = Math.round(timeoutMs / 1000);
    super(
      `A IA não respondeu em ${seconds}s (${label}, ${attempts} tentativa(s)). Tente novamente.`,
      options,
    );
    this.name = "AiTaskTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Executa uma chamada de IA com timeout por tentativa e retentativa apenas em
 * timeout. Erros de API/schema seguem direto para o chamador (o SDK já tem
 * `maxRetries` próprio para 429/5xx).
 */
export async function runAiTask<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
  options?: { timeoutMs?: number; retries?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? aiTaskTimeoutMs();
  const retries = options?.retries ?? aiTaskRetries();
  const attempts = retries + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await run(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) throw error;

      console.warn(
        `[ai-task] ${label} excedeu ${timeoutMs}ms (tentativa ${attempt}/${attempts})`,
      );
      if (attempt === attempts) {
        throw new AiTaskTimeoutError(label, timeoutMs, attempts, {
          cause: error,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Inalcançável: a última tentativa sempre lança.
  throw new AiTaskTimeoutError(label, timeoutMs, attempts);
}
