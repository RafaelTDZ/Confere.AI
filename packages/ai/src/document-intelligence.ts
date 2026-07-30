import type {
  DocumentAI,
  CompareDocumentsResult,
  ExtractDocumentResult,
  MatchProductResult,
} from "@confere/application";
import type { DocumentExtraction } from "@confere/domain";
import type { AIGateway } from "./gateway.js";
import { buildExtractDocumentPrompt } from "./prompts/extract-document.js";
import { buildCompareDocumentsPrompt } from "./prompts/compare-documents.js";
import { buildMatchProductPrompt } from "./prompts/match-product.js";
import { extractionOutputSchema } from "./schemas/document-extraction.js";
import { comparisonResultSchema } from "./schemas/comparison.js";
import { productMatchResultSchema } from "./schemas/product-match.js";

/**
 * Implementacao do port DocumentAI sobre o gateway:
 * combina prompts versionados + schemas Zod + capability routing.
 */
export class GeminiDocumentIntelligence implements DocumentAI {
  constructor(private readonly gateway: AIGateway) {}

  async extractDocument(
    input: Parameters<DocumentAI["extractDocument"]>[0],
  ): Promise<ExtractDocumentResult> {
    const result = await this.gateway.extractStructured(
      {
        capability: "ocr-extraction",
        prompt: buildExtractDocumentPrompt(input.docType),
        files: [input.file],
      },
      extractionOutputSchema,
    );

    return {
      extraction: result.data.extraction as DocumentExtraction,
      confidence: result.data.confidence,
      model: result.model,
      usage: result.usage,
    };
  }

  async compareDocuments(
    input: Parameters<DocumentAI["compareDocuments"]>[0],
  ): Promise<CompareDocumentsResult> {
    const result = await this.gateway.extractStructured(
      {
        capability: "document-comparison",
        prompt: buildCompareDocumentsPrompt(),
        context: { extractions: input.extractions },
      },
      comparisonResultSchema,
    );

    return {
      findings: result.data.findings.map((f) => ({
        field: f.field,
        message: f.message,
        severity: f.severity,
        expected: f.expected ?? null,
        actual: f.actual ?? null,
        suggestion: f.suggestion ?? null,
      })),
      model: result.model,
      usage: result.usage,
    };
  }

  async matchProduct(
    input: Parameters<DocumentAI["matchProduct"]>[0],
  ): Promise<MatchProductResult> {
    const result = await this.gateway.extractStructured(
      {
        capability: "product-matching",
        prompt: buildMatchProductPrompt(),
        context: {
          item: input.item,
          candidates: input.candidates.map((c) => ({
            id: c.id,
            sku: c.sku,
            description: c.description,
            ncm: c.ncm,
            unitWeight: c.unitWeight,
            unitOfMeasure: c.unitOfMeasure,
          })),
        },
      },
      productMatchResultSchema,
    );

    return {
      decision: result.data.decision,
      productId: result.data.productId,
      reasoning: result.data.reasoning,
      model: result.model,
      usage: result.usage,
    };
  }
}
