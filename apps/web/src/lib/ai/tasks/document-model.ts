import { createFireworksClient } from "@/lib/ai/providers/fireworks";
import { createOpenRouterClient } from "@/lib/ai/providers/openrouter";
import { getOpenRouterReasoning } from "@/lib/ai/providers/openrouter-model";
import {
  getAiModelId,
  getAiProvider,
  type AiOverrides,
} from "@/lib/ai/provider";

export type PdfEngine = "native" | "mistral-ocr";

/**
 * Modelo para documentos no provider ativo (AI_PROVIDER).
 * - OpenRouter: plugins file-parser (PDF native) + response-healing + reasoning.
 *   PDFs usam native por padrão; mistral-ocr fica como fallback quando o
 *   processamento nativo falha.
 * - Fireworks (GLM-5.3-Flash, nativamente multimodal para imagens): sem
 *   reasoning/plugins (são opções só do OpenRouter). PDF direto não é
 *   suportado pela API Fireworks — envie PNG/JPG ou use AI_PROVIDER=openrouter.
 */
export function getDocumentLanguageModel(options?: {
  isPdf?: boolean;
  pdfEngine?: PdfEngine;
  overrides?: AiOverrides;
}) {
  const isPdf = options?.isPdf ?? false;
  const overrides = options?.overrides;

  if (getAiProvider(overrides) === "fireworks") {
    if (isPdf) {
      throw new Error(
        "PDF direto não suportado pelo provider Fireworks; envie o documento como PNG/JPG ou troque AI_PROVIDER para openrouter.",
      );
    }
    return createFireworksClient()(getAiModelId(overrides));
  }

  const openrouter = createOpenRouterClient();
  const modelId = getAiModelId(overrides);
  const reasoning = getOpenRouterReasoning("document");
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
 * Sinais explícitos de falha de parse/file no texto do erro (inclui responseBody).
 */
function hasPdfParseFileSignal(text: string): boolean {
  return (
    /failed to parse/i.test(text) ||
    (/pdf/i.test(text) && /parse/i.test(text)) ||
    /file.?parser/i.test(text) ||
    /unsupported.*(file|pdf|document)/i.test(text) ||
    /(file|pdf|document).*(unsupported|not supported|unable|invalid)/i.test(
      text,
    ) ||
    /unable to (process|read|parse).*(file|pdf|document)/i.test(text)
  );
}

/**
 * Indica se vale retry do PDF com mistral-ocr após falha do engine native.
 * Prioriza sinais de parse/file no body (mesmo sob wrapper "Provider returned
 * an error"); rejeita auth/quota; demais erros de provider sem detalhe de
 * parse não disparam OCR.
 */
export function shouldFallbackPdfEngine(error: unknown): boolean {
  const status = errorStatusCode(error);
  const text = errorText(error);

  // Auth e quota: OCR não ajuda — rejeitar mesmo se o body mencionar PDF.
  if (status === 401 || status === 403 || status === 429) return false;
  if (
    /api key/i.test(text) ||
    /unauthorized/i.test(text) ||
    /forbidden/i.test(text) ||
    /(OPENROUTER|FIREWORKS)_API_KEY/i.test(text) ||
    /rate.?limit/i.test(text)
  ) {
    return false;
  }

  // Parse/file no message ou responseBody → fallback, mesmo com wrapper genérico.
  return hasPdfParseFileSignal(text);
}
