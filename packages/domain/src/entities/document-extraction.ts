import type { DocumentType } from "./document.js";
import type { ExtractedItem } from "./product-match.js";

/** Dados estruturados extraidos de um documento pela IA. */
export interface DocumentExtraction {
  docType: DocumentType;
  documentNumber: string | null;
  issueDate: string | null;
  supplierName: string | null;
  buyerName: string | null;
  incoterm: string | null;
  currency: string | null;
  totalQuantity: number | null;
  totalNetWeight: number | null;
  totalGrossWeight: number | null;
  totalValue: number | null;
  items: ExtractedItem[];
}

export interface ExtractionConfidence {
  overall: number;
  perField: Record<string, number>;
}

export interface ExtractionOutput {
  extraction: DocumentExtraction;
  confidence: ExtractionConfidence;
}
