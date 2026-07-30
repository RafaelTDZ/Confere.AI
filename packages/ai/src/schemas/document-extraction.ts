import { z } from "zod";

export const extractedItemSchema = z.object({
  sku: z.string().describe("Codigo/SKU/referencia do item no documento"),
  description: z.string().describe("Descricao comercial completa do item"),
  quantity: z.number().describe("Quantidade do item"),
  unitOfMeasure: z
    .string()
    .nullable()
    .describe("Unidade de medida (UN, PC, CX, KG...)"),
  unitWeight: z.number().nullable().describe("Peso unitario liquido em kg"),
  unitPrice: z.number().nullable().describe("Valor unitario na moeda do documento"),
  ncm: z
    .string()
    .nullable()
    .describe("Codigo NCM de 8 digitos, se presente no documento"),
  attributes: z
    .record(z.unknown())
    .describe("Atributos extras relevantes (marca, modelo, material...)"),
});

export const documentExtractionSchema = z.object({
  docType: z
    .enum(["invoice", "packing_list", "bill_of_lading"])
    .describe("Tipo do documento analisado"),
  documentNumber: z.string().nullable(),
  issueDate: z
    .string()
    .nullable()
    .describe("Data de emissao em ISO 8601 (YYYY-MM-DD)"),
  supplierName: z.string().nullable(),
  buyerName: z.string().nullable(),
  incoterm: z.string().nullable(),
  currency: z.string().nullable().describe("Codigo ISO da moeda (USD, EUR...)"),
  totalQuantity: z.number().nullable(),
  totalNetWeight: z.number().nullable().describe("Peso liquido total em kg"),
  totalGrossWeight: z.number().nullable().describe("Peso bruto total em kg"),
  totalValue: z.number().nullable(),
  items: z.array(extractedItemSchema),
});

export const extractionOutputSchema = z.object({
  extraction: documentExtractionSchema,
  confidence: z.object({
    overall: z
      .number()
      .min(0)
      .max(1)
      .describe("Confianca geral da extracao (0..1)"),
    perField: z.record(z.number().min(0).max(1)),
  }),
});

export type DocumentExtractionSchema = z.infer<typeof documentExtractionSchema>;
export type ExtractionOutputSchema = z.infer<typeof extractionOutputSchema>;
