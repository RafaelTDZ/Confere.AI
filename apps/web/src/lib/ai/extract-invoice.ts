import { generateText, Output } from "ai";
import type { AnalyzeFileInput } from "@/lib/ai/classify";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/document-model";
import { getOpenRouterModel } from "@/lib/ai/model-config";
import {
  invoiceExtractionSchema,
  type InvoiceExtraction,
} from "@/lib/ai/schemas";
import { extractAiTaskUsage, type AiTaskUsage } from "@/lib/ai/usage";

async function extractOnce(file: AnalyzeFileInput, pdfEngine: PdfEngine) {
  const isPdf = file.mediaType === "application/pdf";
  return generateText({
    model: getDocumentLanguageModel({ isPdf, pdfEngine }),
    output: Output.object({
      schema: invoiceExtractionSchema,
      name: "invoice_extraction",
      description: "Campos estruturados da Commercial Invoice",
    }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Extraia os dados da Commercial Invoice (fatura comercial) do documento anexado.",
              "Campos obrigatórios no schema (use null quando não encontrar):",
              "1) number — número da invoice",
              "2) exporter.name — nome do exportador/shipper",
              "3) importer — importador/consignee: name, cnpj, address",
              "4) notify — adquirente/notify party: name, cnpj, address",
              "5) products[] — codigo/referencia (code), NCM/HS (ncm), description",
              "Ignore packing list e bill of lading se estiverem no mesmo arquivo.",
              "Não invente valores; prefira null a chutes.",
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

export async function extractInvoice(
  file: AnalyzeFileInput,
): Promise<{
  invoice: InvoiceExtraction;
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
    result = await extractOnce(file, "native");
  } catch (error) {
    if (isPdf && shouldFallbackPdfEngine(error)) {
      result = await extractOnce(file, "mistral-ocr");
    } else {
      throw error;
    }
  }

  const invoice = result.output;
  if (!invoice) {
    throw new Error("A IA não retornou dados da invoice");
  }

  const usage = extractAiTaskUsage(result, Date.now() - started);

  return {
    invoice,
    model: modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
