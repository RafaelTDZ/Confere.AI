import type {
  DocumentExtraction,
  DocumentType,
  ExtractedItem,
  ExtractionConfidence,
  Finding,
  Product,
} from "@confere/domain";
import type { AIFileRef, AIUsage } from "./ai-provider.js";

export interface ExtractDocumentResult {
  extraction: DocumentExtraction;
  confidence: ExtractionConfidence;
  model: string;
  usage: AIUsage;
}

export interface CompareDocumentsResult {
  findings: Finding[];
  model: string;
  usage: AIUsage;
}

export interface MatchProductResult {
  /** Visao da IA sobre o match; a decisao final combina com regras deterministicas. */
  decision: "new" | "existing" | "uncertain";
  productId: string | null;
  reasoning: string;
  model: string;
  usage: AIUsage;
}

/**
 * Port de alto nivel para inteligencia documental.
 * Implementado por @confere/ai (gateway + adapters); casos de uso
 * dependem apenas desta interface.
 */
export interface DocumentAI {
  extractDocument(input: {
    file: AIFileRef;
    docType: DocumentType;
  }): Promise<ExtractDocumentResult>;

  compareDocuments(input: {
    extractions: DocumentExtraction[];
  }): Promise<CompareDocumentsResult>;

  matchProduct(input: {
    item: ExtractedItem;
    candidates: Product[];
  }): Promise<MatchProductResult>;
}
