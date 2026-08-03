import { generateText, Output } from "ai";
import {
  getDocumentLanguageModel,
  isPdfParseError,
  type PdfEngine,
} from "@/lib/ai/document-model";
import { getOpenRouterModel } from "@/lib/ai/model-config";
import {
  documentClassificationSchema,
  type DocumentClassification,
} from "@/lib/ai/schemas";
import { extractAiTaskUsage, type AiTaskUsage } from "@/lib/ai/usage";

export type AnalyzeFileInput = {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
};

async function classifyOnce(
  file: AnalyzeFileInput,
  pdfEngine: PdfEngine,
) {
  const isPdf = file.mediaType === "application/pdf";
  return generateText({
    model: getDocumentLanguageModel({ isPdf, pdfEngine }),
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

export async function classifyDocument(
  file: AnalyzeFileInput,
): Promise<{
  classification: DocumentClassification;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  usage: AiTaskUsage;
}> {
  const modelId = getOpenRouterModel();
  const isPdf = file.mediaType === "application/pdf";
  const started = Date.now();

  let result;
  try {
    result = await classifyOnce(file, isPdf ? "mistral-ocr" : "native");
  } catch (error) {
    if (isPdf && isPdfParseError(error)) {
      // Fallback: envia o PDF nativo ao modelo (sem OCR prévio do OpenRouter)
      result = await classifyOnce(file, "native");
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
    model: modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
