import { createOpenRouterClient } from "@/lib/ai/openrouter";
import {
  getOpenRouterModel,
  getOpenRouterReasoning,
} from "@/lib/ai/model-config";

export type PdfEngine = "mistral-ocr" | "native" | "pdf-text";

/**
 * Modelo OpenRouter para documentos.
 * PDFs usam mistral-ocr por padrão (melhor em scans/layouts complexos).
 * pdf-text/cloudflare-ai falha em vários PDFs comerciais.
 */
export function getDocumentLanguageModel(options?: {
  isPdf?: boolean;
  pdfEngine?: PdfEngine;
}) {
  const openrouter = createOpenRouterClient();
  const modelId = getOpenRouterModel();
  const reasoning = getOpenRouterReasoning("document");
  const isPdf = options?.isPdf ?? false;
  const pdfEngine = options?.pdfEngine ?? "mistral-ocr";

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

export function isPdfParseError(error: unknown): boolean {
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
  return (
    /failed to parse/i.test(message) ||
    /failed to parse/i.test(body) ||
    /pdf/i.test(message) && /parse/i.test(message)
  );
}
