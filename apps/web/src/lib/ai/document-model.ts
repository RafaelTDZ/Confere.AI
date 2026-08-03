import { createOpenRouterClient } from "@/lib/ai/openrouter";
import {
  getOpenRouterModel,
  getOpenRouterReasoning,
} from "@/lib/ai/model-config";

export type PdfEngine = "native" | "mistral-ocr";

/**
 * Modelo OpenRouter para documentos.
 * PDFs usam native por padrão (modelos com input file, ex.: gpt-5.6-luna).
 * mistral-ocr fica como fallback quando o processamento nativo falha.
 */
export function getDocumentLanguageModel(options?: {
  isPdf?: boolean;
  pdfEngine?: PdfEngine;
}) {
  const openrouter = createOpenRouterClient();
  const modelId = getOpenRouterModel();
  const reasoning = getOpenRouterReasoning("document");
  const isPdf = options?.isPdf ?? false;
  const pdfEngine = options?.pdfEngine ?? "native";

  return openrouter(modelId, {
    ...(reasoning ? { reasoning } : {}),
    plugins: [
      ...(isPdf
        ? ([{ id: "file-parser" as const, pdf: { engine: pdfEngine } }] as const)
        : []),
      { id: "response-healing" as const },
    ],
  });
}

function errorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

function errorText(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const body =
    error && typeof error === "object" && "responseBody" in error
      ? String((error as { responseBody?: unknown }).responseBody ?? "")
      : "";
  return `${message}\n${body}`;
}

/**
 * Indica se vale retry do PDF com mistral-ocr após falha do engine native.
 * Não retenta erros de auth/config (API key, 401/403).
 */
export function shouldFallbackPdfEngine(error: unknown): boolean {
  const status = errorStatusCode(error);
  if (status === 401 || status === 403) return false;

  const text = errorText(error);
  if (
    /api key/i.test(text) ||
    /unauthorized/i.test(text) ||
    /forbidden/i.test(text) ||
    /OPENROUTER_API_KEY/i.test(text)
  ) {
    return false;
  }

  return (
    /failed to parse/i.test(text) ||
    (/pdf/i.test(text) && /parse/i.test(text)) ||
    /file.?parser/i.test(text) ||
    /unsupported.*(file|pdf|document)/i.test(text) ||
    /(file|pdf|document).*(unsupported|not supported|unable|invalid)/i.test(
      text,
    ) ||
    /unable to (process|read|parse).*(file|pdf|document)/i.test(text) ||
    /provider.*(error|returned)/i.test(text) ||
    /bad request/i.test(text) ||
    status === 400 ||
    status === 422 ||
    status === 502
  );
}
