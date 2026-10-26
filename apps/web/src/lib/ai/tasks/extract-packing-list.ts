import "server-only";

import { generateText, Output } from "ai";
import type { AnalyzeFileInput } from "@/lib/ai/tasks/classify";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/tasks/document-model";
import { getAiModelId, getAiProvider, type AiOverrides } from "@/lib/ai/provider";
import {
  packingListExtractionSchema,
  type PackingListExtraction,
} from "@/lib/ai/schemas";
import { extractAiTaskUsage, type AiTaskUsage } from "@/lib/ai/usage";

async function extractOnce(
  file: AnalyzeFileInput,
  pdfEngine: PdfEngine,
  overrides?: AiOverrides,
) {
  const isPdf = file.mediaType === "application/pdf";
  return generateText({
    model: getDocumentLanguageModel({ isPdf, pdfEngine, overrides }),
    output: Output.object({
      schema: packingListExtractionSchema,
      name: "packing_list_extraction",
      description: "Número da Invoice referenciado no Packing List",
    }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Analise o Packing List (romaneio) anexado.",
              "Extraia somente o número da Commercial Invoice associado a este Packing List, quando estiver explicitamente indicado.",
              "Não confunda o número do Packing List, PO, pedido, embarque ou referência com o número da Invoice.",
              "Se não houver um número de Invoice explícito, retorne null. Não invente nem deduza valores.",
            ].join("\n"),
          },
          {
            type: "file",
            mediaType: file.mediaType,
            filename: file.filename,
            data: file.bytes,
          },
        ],
      },
    ],
  });
}

export async function extractPackingList(
  file: AnalyzeFileInput,
  overrides?: AiOverrides,
): Promise<{
  packingList: PackingListExtraction;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  usage: AiTaskUsage;
}> {
  const modelId = getAiModelId(overrides);
  const isPdf = file.mediaType === "application/pdf";
  const started = Date.now();

  let result;
  try {
    result = await extractOnce(file, "native", overrides);
  } catch (error) {
    if (
      isPdf &&
      getAiProvider(overrides) === "openrouter" &&
      shouldFallbackPdfEngine(error)
    ) {
      result = await extractOnce(file, "mistral-ocr", overrides);
    } else {
      throw error;
    }
  }

  const packingList = result.output;
  if (!packingList) {
    throw new Error("A IA não retornou dados do Packing List");
  }

  const invoiceNumber = packingList.invoiceNumber?.trim().replace(/\s+/g, " ");
  const usage = extractAiTaskUsage(result, Date.now() - started);

  return {
    packingList: {
      invoiceNumber: invoiceNumber || null,
    },
    model: modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
