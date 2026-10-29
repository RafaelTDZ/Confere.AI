import "server-only";

import { generateText, Output } from "ai";
import type { PreparedDocument } from "@/lib/ai/document-content";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/tasks/document-model";
import {
  documentClassificationSchema,
  type DocumentClassification,
} from "@/lib/ai/schemas";
import { runAiTask } from "@/lib/ai/task-timeout";
import { extractAiTaskUsage, type AiTaskUsage } from "@/lib/ai/usage";

export type { AnalyzeFileInput } from "@/lib/ai/document-content";

async function classifyOnce(
  prepared: PreparedDocument,
  pdfEngine: PdfEngine,
  abortSignal: AbortSignal,
) {
  return generateText({
    abortSignal,
    model: getDocumentLanguageModel({
      provider: prepared.provider,
      modelId: prepared.modelId,
      isPdf: prepared.isPdf,
      pdfEngine,
    }),
    output: Output.object({
      schema: documentClassificationSchema,
      name: "document_classification",
      description:
        "Tipos de documentos de importação presentes no arquivo enviado",
    }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Analise o documento de comércio exterior anexado.",
              "Identifique TODOS os tipos presentes no arquivo (pode haver mais de um no mesmo PDF/imagem).",
              "Tipos válidos:",
              "- invoice: Commercial Invoice / fatura comercial",
              "- packing_list: Packing List / romaneio",
              "- bill_of_lading: Bill of Lading / conhecimento de embarque (BL/AWB)",
              "Retorne apenas os tipos realmente presentes.",
            ].join("\n"),
          },
          ...prepared.content,
        ],
      },
    ],
  });
}

export async function classifyDocument(prepared: PreparedDocument): Promise<{
  classification: DocumentClassification;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  usage: AiTaskUsage;
}> {
  const started = Date.now();

  let result;
  try {
    result = await runAiTask("classify", (signal) =>
      classifyOnce(prepared, "native", signal),
    );
  } catch (error) {
    if (
      prepared.isPdf &&
      prepared.provider === "openrouter" &&
      shouldFallbackPdfEngine(error)
    ) {
      // Fallback: OCR via OpenRouter quando o processamento nativo falha
      result = await runAiTask("classify:mistral-ocr", (signal) =>
        classifyOnce(prepared, "mistral-ocr", signal),
      );
    } else {
      throw error;
    }
  }

  const classification = result.output;
  if (!classification?.types?.length) {
    throw new Error("A IA não identificou nenhum tipo de documento");
  }

  const seen = new Set<string>();
  const types = classification.types.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  const usage = extractAiTaskUsage(result, Date.now() - started);

  return {
    classification: { ...classification, types },
    model: prepared.modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
