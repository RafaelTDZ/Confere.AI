import "server-only";

import { generateText, Output } from "ai";
import type { PreparedDocument } from "@/lib/ai/document-content";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/tasks/document-model";
import {
  invoiceExtractionSchema,
  type InvoiceExtraction,
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
              "2) blNumber — número do BL/AWB se aparecer na invoice; senão null",
              "3) exporter.name — nome do exportador/shipper",
              "4) importer — importador/consignee: name, cnpj, address { street, number, complement, postalCode, city, state, country, other }",
              "5) notify — adquirente/notify party: name, cnpj, address { street, number, complement, postalCode, city, state, country, other }",
              "Separe o endereço nesses campos; não junte tudo em um único texto. Use other só para bairro, referência ou o que não couber nos demais.",
              "6) products[] — codigo/referencia (code), NCM/HS (ncm), description",
              "Ignore packing list e demais campos de BL no mesmo arquivo; extraia só o número do BL se constar.",
              "Não invente valores; prefira null a chutes.",
            ].join("\n"),
          },
          ...prepared.content,
        ],
      },
    ],
  });
}

export async function extractInvoice(prepared: PreparedDocument): Promise<{
  invoice: InvoiceExtraction;
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

  const invoice = result.output;
  if (!invoice) {
    throw new Error("A IA não retornou dados da invoice");
  }

  const usage = extractAiTaskUsage(result, Date.now() - started);

  return {
    invoice,
    model: prepared.modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
