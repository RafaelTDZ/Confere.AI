import { z } from "zod";

export const documentTypeSchema = z.enum([
  "invoice",
  "packing_list",
  "bill_of_lading",
]);

export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentClassificationSchema = z.object({
  types: z
    .array(documentTypeSchema)
    .min(1)
    .describe(
      "Tipos de documento de importação presentes no arquivo (pode haver mais de um)",
    ),
  notes: z
    .string()
    .optional()
    .describe("Observação breve sobre a classificação, se útil"),
});

export type DocumentClassification = z.infer<typeof documentClassificationSchema>;

const partySchema = z.object({
  name: z.string().nullable().describe("Razão social ou nome"),
  cnpj: z
    .string()
    .nullable()
    .describe("CNPJ ou equivalente fiscal, se houver"),
  address: z.string().nullable().describe("Endereço completo, se houver"),
});

const exporterSchema = z.object({
  name: z.string().nullable().describe("Nome do exportador / shipper"),
});

export const invoiceProductSchema = z.object({
  code: z
    .string()
    .nullable()
    .describe("Código / referência / SKU do produto"),
  ncm: z
    .string()
    .nullable()
    .describe("NCM ou HS code"),
  description: z.string().nullable().describe("Descrição do produto"),
});

export const invoiceExtractionSchema = z.object({
  number: z
    .string()
    .nullable()
    .describe("Número da invoice / commercial invoice"),
  exporter: exporterSchema.describe("Dados do exportador (shipper)"),
  importer: partySchema.describe(
    "Importador / consignee (nome, CNPJ e endereço)",
  ),
  notify: partySchema.describe(
    "Adquirente / notify party (nome, CNPJ e endereço)",
  ),
  products: z
    .array(invoiceProductSchema)
    .describe("Linhas de produto da invoice"),
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;
