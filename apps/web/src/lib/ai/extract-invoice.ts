import { generateText, Output } from "ai";
import {
  createOpenRouterClient,
  getOpenRouterModel,
} from "@/lib/ai/openrouter";
import {
  invoiceExtractionSchema,
  type InvoiceExtraction,
} from "@/lib/ai/schemas";
import type { AnalyzeFileInput } from "@/lib/ai/classify";

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

export async function extractInvoice(
  file: AnalyzeFileInput,
): Promise<{
  invoice: InvoiceExtraction;
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

  const invoice = result.output;
  if (!invoice) {
    throw new Error("A IA não retornou dados da invoice");
  }

  return {
    invoice,
    model: modelId,
    tokensIn: result.usage?.inputTokens ?? 0,
    tokensOut: result.usage?.outputTokens ?? 0,
    latencyMs: Date.now() - started,
  };
}
