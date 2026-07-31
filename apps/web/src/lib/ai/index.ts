export {
  createOpenRouterClient,
  getDefaultLanguageModel,
  getOpenRouterApiKey,
  getOpenRouterModel,
  OpenRouterConfigError,
} from "@/lib/ai/openrouter";
export {
  documentClassificationSchema,
  documentTypeSchema,
  invoiceExtractionSchema,
  invoiceProductSchema,
  type DocumentClassification,
  type DocumentType,
  type InvoiceExtraction,
} from "@/lib/ai/schemas";
export { classifyDocument } from "@/lib/ai/classify";
export { extractInvoice } from "@/lib/ai/extract-invoice";
