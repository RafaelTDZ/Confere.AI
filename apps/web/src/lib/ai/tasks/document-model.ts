import "server-only";

import { createFireworksClient } from "@/lib/ai/providers/fireworks";
import { createOpenRouterClient } from "@/lib/ai/providers/openrouter";
import { getOpenRouterReasoning } from "@/lib/ai/providers/openrouter-model";
import type { AiProviderId } from "@/lib/ai/provider";

export type PdfEngine = "native" | "mistral-ocr";

/**
 * Opções de provider para as tasks de documento.
 *
 * As quatro tasks (classificar e extrair) devolvem dados estruturados por
 * schema fechado: o "thinking" do DeepSeek/GLM quase não melhora o resultado e
 * consome ~80% dos tokens de saída. Medido no BL `276959744`
 * (`deepseek-v4p1-flash-1017`, mesmo markdown e mesmo prompt):
 * - thinking padrão: 17,6s, 4.000 tokens de saída, 3.853 de raciocínio e JSON
 *   truncado quando o teto de tokens bate;
 * - thinking desligado: 2,8s, 477 tokens, 0 de raciocínio, mesmos campos.
 *
 * `AI_DOCUMENT_THINKING`:
 * - ausente/`disabled` (padrão): sem raciocínio — mais rápido;
 * - `enabled`: comportamento anterior (raciocínio do provider);
 * - número ≥ 1024 (ex.: `1024`): thinking com esse orçamento de tokens.
 */
export function documentProviderOptions(
  provider: AiProviderId,
):
  | { fireworks: { thinking: { type: "disabled" } } }
  | { fireworks: { thinking: { type: "enabled"; budgetTokens: number } } }
  | undefined {
  if (provider !== "fireworks") return undefined;

  const raw = process.env.AI_DOCUMENT_THINKING?.trim().toLowerCase();
  if (raw === "enabled") return undefined;

  const budget = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(budget) && budget >= 1024) {
    return {
      fireworks: { thinking: { type: "enabled", budgetTokens: budget } },
    };
  }

  return { fireworks: { thinking: { type: "disabled" } } };
}

export type DocumentLanguageModelOptions = {
  provider: AiProviderId;
  modelId: string;
  isPdf?: boolean;
  pdfEngine?: PdfEngine;
};

/**
 * Modelo para documentos no provider/modelo efetivos.
 * - Fireworks: client puro (PDF já foi convertido em imagens pelo pipeline).
 * - OpenRouter: PDFs usam file-parser (engine native) por padrão; mistral-ocr
 *   fica como fallback quando o processamento nativo falha. Inclui ainda o
 *   plugin response-healing + reasoning.
 */
export function getDocumentLanguageModel(
  options: DocumentLanguageModelOptions,
) {
  if (options.provider === "fireworks") {
    const fireworks = createFireworksClient();
    return fireworks(options.modelId);
  }

  const isPdf = options.isPdf ?? false;
  const pdfEngine = options.pdfEngine ?? "native";

  const openrouter = createOpenRouterClient();
  const reasoning = getOpenRouterReasoning("document");

  return openrouter(options.modelId, {
    ...(reasoning ? { reasoning } : {}),
    plugins: [
      ...(isPdf
        ? ([
            { id: "file-parser" as const, pdf: { engine: pdfEngine } },
          ] as const)
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
    /OPENROUTER_API_KEY/i.test(text) ||
    /rate.?limit/i.test(text)
  ) {
    return false;
  }

  // Parse/file no message ou responseBody → fallback, mesmo com wrapper genérico.
  return hasPdfParseFileSignal(text);
}
