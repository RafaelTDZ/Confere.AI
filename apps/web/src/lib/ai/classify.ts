import { generateText, Output } from "ai";
import {
  createOpenRouterClient,
  getOpenRouterModel,
} from "@/lib/ai/openrouter";
import {
  documentClassificationSchema,
  type DocumentClassification,
} from "@/lib/ai/schemas";

export type AnalyzeFileInput = {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
};

function buildModel(isPdf: boolean) {
  const openrouter = createOpenRouterClient();
  const modelId = getOpenRouterModel();
  return openrouter(modelId, {
    plugins: [
      ...(isPdf
        ? ([{ id: "file-parser" as const, pdf: { engine: "pdf-text" as const } }] as const)
        : []),
      { id: "response-healing" as const },
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
}> {
  const modelId = getOpenRouterModel();
  const isPdf = file.mediaType === "application/pdf";
  const started = Date.now();

  const result = await generateText({
    model: buildModel(isPdf),
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

  const classification = result.output;
  if (!classification?.types?.length) {
    throw new Error("A IA não identificou nenhum tipo de documento");
  }

  // Dedup preservando ordem
  const seen = new Set<string>();
  const types = classification.types.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  return {
    classification: { ...classification, types },
    model: modelId,
    tokensIn: result.usage?.inputTokens ?? 0,
    tokensOut: result.usage?.outputTokens ?? 0,
    latencyMs: Date.now() - started,
  };
}
