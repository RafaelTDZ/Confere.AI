import "server-only";

import { z } from "zod";
import {
  consumeDocumentParseCredits,
  getCachedDocumentParse,
  getDocumentParseCreditsUsed,
  saveDocumentParse,
} from "@/lib/documents/document-parses";
import { withSpan } from "@/lib/observability/tracing";

/** PDF convertido em markdown pelo Firecrawl. */
type ParsedPdfDocument = {
  markdown: string;
  pages: number;
  credits: number;
  cached: boolean;
};

export type ParsePdfResult =
  | { ok: true; document: ParsedPdfDocument }
  | { ok: false; errorCode: string; errorMessage: string };

const DEFAULT_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_MAX_PAGES = 30;
const DEFAULT_OCR_MODE = "auto";
const DEFAULT_MONTHLY_CREDITS = 5_000;
const DEFAULT_MIN_CHARS = 200;
const DEFAULT_MAX_CHARS = 120_000;
const DEFAULT_TIMEOUT_MS = 90_000;

/** Mensagens de erro vão para log e para o worker; não precisam ser longas. */
const MAX_ERROR_MESSAGE_CHARS = 500;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function parseIntEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) return fallback;
  return value;
}

/**
 * O parse só roda com a chave do Firecrawl e com o provider diferente de
 * `images` (que mantém o pipeline PDF→JPEG/PDF nativo).
 */
export function isDocumentParseEnabled(): boolean {
  if (process.env.DOCUMENT_PARSE_PROVIDER?.trim().toLowerCase() === "images") {
    return false;
  }
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export function documentParseMaxPages(): number {
  return parseIntEnv("DOCUMENT_PARSE_MAX_PAGES", DEFAULT_MAX_PAGES, 1);
}

export function documentParseOcrMode(): "auto" | "ocr" | "fast" {
  const raw = process.env.DOCUMENT_PARSE_OCR_MODE?.trim().toLowerCase();
  if (raw === "ocr" || raw === "fast") return raw;
  return DEFAULT_OCR_MODE;
}

export function documentParseMonthlyCredits(): number {
  return parseIntEnv(
    "DOCUMENT_PARSE_MONTHLY_CREDITS",
    DEFAULT_MONTHLY_CREDITS,
    0,
  );
}

export function documentParseMinChars(): number {
  return parseIntEnv("DOCUMENT_PARSE_MIN_CHARS", DEFAULT_MIN_CHARS, 0);
}

export function documentParseMaxChars(): number {
  return parseIntEnv("DOCUMENT_PARSE_MAX_CHARS", DEFAULT_MAX_CHARS, 1);
}

export function documentParseTimeoutMs(): number {
  return parseIntEnv("DOCUMENT_PARSE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000);
}

function firecrawlBaseUrl(): string {
  return (
    process.env.FIRECRAWL_BASE_URL?.trim().replace(/\/+$/, "") ||
    DEFAULT_BASE_URL
  );
}

/**
 * Só o que o parser consome. `success`/`code`/`error` chegam também em
 * respostas de erro (200 com falha lógica ou 4xx/5xx com JSON).
 */
const firecrawlParseResponseSchema = z.object({
  success: z.boolean().nullish(),
  data: z
    .object({
      markdown: z.string(),
      metadata: z.object({ numPages: z.number().nullish() }).nullish(),
    })
    .nullish(),
  code: z.string().nullish(),
  // Em zod 4 `z.unknown()` é obrigatório; `optional` aceita respostas sem erro.
  error: z.unknown().optional(),
});

function mapHttpStatusToErrorCode(status: number): string {
  if (status === 401 || status === 403) return "firecrawl_unauthorized";
  if (status === 402) return "firecrawl_no_credits";
  if (status === 429) return "firecrawl_rate_limited";
  if (status >= 500) return "firecrawl_unavailable";
  return "firecrawl_error";
}

/** Firecrawl devolve string, `{ message }` ou objeto de erro genérico. */
function errorMessageFrom(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, MAX_ERROR_MESSAGE_CHARS);
  }
  if (value !== null && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim().slice(0, MAX_ERROR_MESSAGE_CHARS);
    }
  }
  return fallback;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function isValidParseInput(params: {
  tenantId: string;
  sha256: string;
  bytes: Uint8Array;
  filename: string;
}): boolean {
  return (
    params.tenantId.trim().length > 0 &&
    SHA256_PATTERN.test(params.sha256.trim()) &&
    params.filename.trim().length > 0 &&
    params.bytes instanceof Uint8Array &&
    params.bytes.byteLength > 0
  );
}

function parseFormData(params: {
  bytes: Uint8Array;
  filename: string;
}): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(params.bytes)], { type: "application/pdf" }),
    params.filename,
  );
  form.append(
    "options",
    JSON.stringify({
      formats: ["markdown"],
      parsers: [
        {
          type: "pdf",
          mode: documentParseOcrMode(),
          maxPages: documentParseMaxPages(),
          pages: true,
        },
      ],
    }),
  );
  return form;
}

/**
 * Converte um PDF em markdown com `POST /v2/parse` (1 crédito por página).
 *
 * - cache por `(tenantId, sha256)` evita reparse do mesmo arquivo;
 * - orçamento mensal por tenant é checado antes da chamada;
 * - o parse é acessório: todo erro vira `errorCode` para o chamador cair no
 *   pipeline anterior (imagens/PDF) sem derrubar a análise.
 */
export async function parsePdfWithFirecrawl(params: {
  tenantId: string;
  sha256: string;
  bytes: Uint8Array;
  filename: string;
}): Promise<ParsePdfResult> {
  if (!isValidParseInput(params)) {
    return {
      ok: false,
      errorCode: "invalid_input",
      errorMessage:
        "tenant, sha256 (64 hex), nome do arquivo e bytes do PDF são obrigatórios.",
    };
  }

  const apiKey = process.env.FIRECRAWL_API_KEY?.trim() ?? "";

  if (!isDocumentParseEnabled()) {
    return {
      ok: false,
      errorCode: "parse_disabled",
      errorMessage:
        "Parse de PDF desligado: DOCUMENT_PARSE_PROVIDER=images ou FIRECRAWL_API_KEY ausente.",
    };
  }

  return withSpan(
    "ai.parse_document",
    { "parse.provider": "firecrawl", "parse.cached": false },
    async (span) => {
      const minChars = documentParseMinChars();
      const maxChars = documentParseMaxChars();
      const limit = documentParseMonthlyCredits();

      const cached = await getCachedDocumentParse(
        params.tenantId,
        params.sha256,
      );
      if (cached && cached.markdown.length >= minChars) {
        span.setAttributes({
          "parse.cached": true,
          "parse.pages": cached.pages,
          "parse.chars": cached.markdown.length,
        });
        return {
          ok: true,
          document: {
            markdown: cached.markdown,
            pages: cached.pages,
            credits: 0,
            cached: true,
          },
        };
      }

      if (limit > 0) {
        const used = await getDocumentParseCreditsUsed(params.tenantId);
        if (used >= limit) {
          return {
            ok: false,
            errorCode: "budget_exhausted",
            errorMessage: `Orçamento mensal de parse esgotado (${used}/${limit} créditos).`,
          };
        }
      }

      const timeoutMs = documentParseTimeoutMs();

      let response: Response;
      try {
        response = await fetch(`${firecrawlBaseUrl()}/v2/parse`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: parseFormData(params),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          return {
            ok: false,
            errorCode: "firecrawl_timeout",
            errorMessage: `Firecrawl não respondeu em ${timeoutMs} ms.`,
          };
        }
        return {
          ok: false,
          errorCode: "firecrawl_network_error",
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, MAX_ERROR_MESSAGE_CHARS)
              : String(error).slice(0, MAX_ERROR_MESSAGE_CHARS),
        };
      }

      const raw: unknown = await response.json().catch(() => null);
      const result =
        raw === null ? null : firecrawlParseResponseSchema.safeParse(raw);
      const payload = result?.success ? result.data : null;

      if (!response.ok) {
        return {
          ok: false,
          errorCode: mapHttpStatusToErrorCode(response.status),
          errorMessage: errorMessageFrom(
            payload?.error,
            `Firecrawl respondeu ${response.status}.`,
          ),
        };
      }

      if (!payload) {
        return {
          ok: false,
          errorCode: "firecrawl_invalid_response",
          errorMessage: "Resposta do Firecrawl em formato inesperado.",
        };
      }

      if (payload.success === false) {
        return {
          ok: false,
          errorCode: "firecrawl_error",
          errorMessage: errorMessageFrom(
            payload.error,
            payload.code ?? "Firecrawl não conseguiu processar o PDF.",
          ),
        };
      }

      const markdown = payload.data?.markdown?.trim() ?? "";
      if (markdown.length === 0) {
        return {
          ok: false,
          errorCode: "firecrawl_invalid_response",
          errorMessage: "Resposta do Firecrawl sem markdown.",
        };
      }

      const numPages = payload.data?.metadata?.numPages;
      const pages =
        typeof numPages === "number" &&
        Number.isFinite(numPages) &&
        numPages > 0
          ? Math.floor(numPages)
          : 1;
      // Custo do `/v2/parse`: 1 crédito por página processada.
      const credits = pages;

      if (markdown.length < minChars) {
        return {
          ok: false,
          errorCode: "parse_too_short",
          errorMessage: `Markdown do PDF tem ${markdown.length} caracteres; o mínimo é ${minChars}.`,
        };
      }

      const truncated =
        markdown.length > maxChars ? markdown.slice(0, maxChars) : markdown;

      const consumed = await consumeDocumentParseCredits({
        tenantId: params.tenantId,
        credits,
        limit,
      });
      if (!consumed) {
        console.warn(
          `[document-parse] orçamento de parse excedido em ${credits} créditos (limite ${limit}); documento processado mesmo assim.`,
        );
      }

      try {
        await saveDocumentParse({
          tenantId: params.tenantId,
          sha256: params.sha256,
          markdown: truncated,
          pages,
          credits,
        });
      } catch (error) {
        // Cache é otimização: uma falha aqui não invalida o markdown obtido.
        console.warn("[document-parse] falha ao salvar o cache do parse:", error);
      }

      span.setAttributes({
        "parse.pages": pages,
        "parse.chars": truncated.length,
      });

      return {
        ok: true,
        document: {
          markdown: truncated,
          pages,
          credits,
          cached: false,
        },
      };
    },
  );
}
