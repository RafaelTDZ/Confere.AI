import "server-only";

import { generateText, Output } from "ai";
import type { PreparedDocument } from "@/lib/ai/document-content";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/tasks/document-model";
import {
  packingListExtractionSchema,
  type PackingListExtraction,
} from "@/lib/ai/schemas";
import { extractAiTaskUsage, type AiTaskUsage } from "@/lib/ai/usage";

async function extractOnce(
  prepared: PreparedDocument,
  pdfEngine: PdfEngine,
) {
  return generateText({
    model: getDocumentLanguageModel({
      provider: prepared.provider,
      modelId: prepared.modelId,
      isPdf: prepared.isPdf,
      pdfEngine,
    }),
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
          ...prepared.content,
        ],
      },
    ],
  });
}

export async function extractPackingList(
  prepared: PreparedDocument,
): Promise<{
  packingList: PackingListExtraction;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  usage: AiTaskUsage;
}> {
  const started = Date.now();

  let result;
  try {
    result = await extractOnce(prepared, "native");
  } catch (error) {
    if (
      prepared.isPdf &&
      prepared.provider === "openrouter" &&
      shouldFallbackPdfEngine(error)
    ) {
      result = await extractOnce(prepared, "mistral-ocr");
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
    model: prepared.modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
