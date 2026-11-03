import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Log estruturado de uma linha (JSON) para runtime logs da Vercel e drains.
 *
 * Por que JSON: `console.error("[x]", erro)` só entrega a mensagem — nenhum
 * campo dá para filtrar. Com um objeto por linha, `tenantId`, `importId`,
 * `jobId`, `provider`, `carrier`, `elapsedMs` etc. viram campos pesquisáveis
 * (Vercel, `vercel logs --json`, Datadog, Better Stack).
 *
 * Todo log passa por `runWithLogContext` (AsyncLocalStorage): quem abre a
 * request/job define o contexto uma vez e os módulos internos não precisam
 * repetir `tenantId`/`importId` em cada chamada.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_STRING_CHARS = 1_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 4;

/**
 * Campos que nunca podem ir para o log. A comparação é por "palavra" do nome
 * do campo (`access_token`, `api_key`, `FIRECRAWL_API_KEY`, `password`), então
 * `tokensIn`/`tokensOut` (contagem de tokens, não credencial) continuam
 * visíveis.
 */
const SECRET_KEY =
  /(^|_)(password|passwd|pwd|secret|token|authorization|cookie|credential|credentials|apikey|session|signature)($|_)|api[_-]?key|private[_-]?key|service[_-]?role|secret[_-]?key/i;

const storage = new AsyncLocalStorage<LogContext>();

/** Nível ativo. `LOG_LEVEL=debug|info|warn|error|silent` vence o default. */
export function currentLogLevel(): LogLevel | "silent" {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw === "silent" || raw === "off" || raw === "none") return "silent";
  if (raw && raw in LEVEL_WEIGHT) return raw as LogLevel;

  if (process.env.NODE_ENV === "production") return "info";
  // Suíte de testes fica silenciosa por padrão: os testes espionam
  // `console.error`/`console.warn` e logs de fluxo só poluiriam as asserções.
  if (process.env.NODE_ENV === "test") return "warn";
  return "debug";
}

export function isLevelEnabled(level: LogLevel): boolean {
  const active = currentLogLevel();
  if (active === "silent") return false;
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[active];
}

/** Erro achatado em campos serializáveis, preservando stack e `cause`. */
export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: SerializedError | string;
  details?: unknown;
};

export function serializeError(error: unknown): SerializedError {
  return toSerializedError(error, 0);
}

function toSerializedError(
  error: unknown,
  depth: number,
): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) serialized.stack = truncate(error.stack);
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      serialized.code = code;
    }
    const details = (error as { details?: unknown }).details;
    if (details !== undefined) serialized.details = normalize(details, depth + 1);
    if (error.cause !== undefined && depth < 2) {
      serialized.cause =
        error.cause instanceof Error
          ? toSerializedError(error.cause, depth + 1)
          : truncate(String(error.cause));
    }
    return serialized;
  }

  if (typeof error === "string") {
    return { name: "Error", message: truncate(error) };
  }

  return {
    name: "UnknownError",
    message: truncate(safeStringify(error) ?? String(error)),
  };
}

function truncate(value: string): string {
  return value.length > MAX_STRING_CHARS
    ? `${value.slice(0, MAX_STRING_CHARS)}…(${value.length - MAX_STRING_CHARS} chars)`
    : value;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Converte qualquer valor em algo seguro para JSON: erros viram objetos,
 * strings longas são truncadas, ciclos são cortados e segredos redigidos.
 */
function normalize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "string") return truncate(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value;
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();

  if (depth >= MAX_DEPTH) return "[truncated:depth]";

  if (Array.isArray(value)) {
    const total = Math.min(value.length, MAX_ARRAY_ITEMS);
    const items: unknown[] = [];
    for (let index = 0; index < total; index += 1) {
      items.push(readSafely(value, index, depth, seen));
    }
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return items;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    const normalized: LogFields = {};
    for (const key of Object.keys(value).slice(0, MAX_OBJECT_KEYS)) {
      normalized[key] = SECRET_KEY.test(key)
        ? "[redacted]"
        : readSafely(value, key, depth, seen);
    }
    return normalized;
  }

  return String(value);
}

/**
 * Lê uma propriedade sem deixar um getter que lança derrubar o log (acontece
 * com erro de SDK/`Response` que expõe `body` como getter).
 */
function readSafely(
  source: object,
  key: string | number,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  try {
    return normalize(
      (source as Record<string | number, unknown>)[key],
      depth + 1,
      seen,
    );
  } catch {
    return "[unreadable]";
  }
}

function normalizeFields(fields: LogFields | undefined): LogFields {
  if (!fields) return {};
  const normalized = normalize(fields);
  return (normalized as LogFields | undefined) ?? {};
}

function emit(level: LogLevel, scope: string, event: string, fields?: LogFields): void {
  if (!isLevelEnabled(level)) return;

  const payload: LogFields = {
    level,
    time: new Date().toISOString(),
    scope,
    event,
    ...normalizeFields(storage.getStore()),
    ...normalizeFields(fields),
  };

  const line =
    safeStringify(payload) ??
    `{"level":"${level}","scope":"${scope}","event":"${event}","logError":"payload não serializável"}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Logger com contexto fixo (ex.: `{ carrier: "maersk" }`) herdado. */
  child(fields: LogFields): Logger;
};

/**
 * Cria um logger de escopo fixo (`scope` identifica o módulo/rota).
 * `event` deve ser um identificador estável em snake_case (`job_failed`,
 * `tracking_skip_cooldown`) — é ele que vai virar filtro no painel.
 */
export function createLogger(scope: string, baseFields?: LogFields): Logger {
  const logger: Logger = {
    debug: (event, fields) => emit("debug", scope, event, { ...baseFields, ...fields }),
    info: (event, fields) => emit("info", scope, event, { ...baseFields, ...fields }),
    warn: (event, fields) => emit("warn", scope, event, { ...baseFields, ...fields }),
    error: (event, fields) => emit("error", scope, event, { ...baseFields, ...fields }),
    child: (fields) => createLogger(scope, { ...baseFields, ...fields }),
  };
  return logger;
}

/** Contexto herdado pela cadeia atual (request, job, cron). */
export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

/**
 * Executa `fn` com contexto de log herdado por tudo que ela chamar.
 * Uso nos pontos de entrada: rota, worker, cron e pipeline.
 */
export function runWithLogContext<T>(
  context: LogContext,
  fn: () => T,
): T {
  return storage.run({ ...getLogContext(), ...context }, fn);
}

/**
 * Açúcar para o log único de "fim de operação": devolve um `finished(...)`
 * que calcula `elapsedMs` a partir de agora.
 */
export function createTimer(): {
  startedAt: number;
  elapsedMs(): number;
} {
  const startedAt = Date.now();
  return { startedAt, elapsedMs: () => Date.now() - startedAt };
}
