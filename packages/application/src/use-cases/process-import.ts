import type {
  DocumentExtraction,
  ExtractedItem,
  Finding,
  ProductMatch,
} from "@confere/domain";
import {
  compareExtractions,
  decideProductMatch,
  isRequiredDocumentSetComplete,
  worstSeverity,
} from "@confere/domain";
import type { FileStorage } from "../ports/file-storage.js";
import type { DocumentAI } from "../ports/document-ai.js";
import type {
  AILogRepository,
  AnalysisRepository,
  DocumentRepository,
  ExtractionRepository,
  ImportRepository,
  ProductMatchRepository,
  ProductRepository,
} from "../ports/repositories.js";
import { NotFoundError, ValidationError } from "../errors.js";

export interface ProcessImportDeps {
  imports: ImportRepository;
  documents: DocumentRepository;
  extractions: ExtractionRepository;
  analyses: AnalysisRepository;
  products: ProductRepository;
  productMatches: ProductMatchRepository;
  aiLogs: AILogRepository;
  storage: FileStorage;
  documentAI: DocumentAI;
}

export interface ProcessImportResult {
  importId: string;
  extractedDocuments: number;
  findingsCount: number;
  matchesCount: number;
}

/**
 * Pipeline de processamento de uma importacao (executado pelo worker):
 * extracao IA por documento -> comparacao (deterministica + IA) ->
 * matching de produtos -> status awaiting_review.
 */
export class ProcessImport {
  constructor(private readonly deps: ProcessImportDeps) {}

  async execute(input: {
    importId: string;
    tenantId: string;
  }): Promise<ProcessImportResult> {
    const { imports, documents } = this.deps;
    const importRecord = await imports.findById(input.tenantId, input.importId);
    if (!importRecord) throw new NotFoundError("Importacao", input.importId);

    await imports.updateStatus(input.tenantId, input.importId, "processing");

    try {
      const docs = await documents.listByImport(input.tenantId, input.importId);
      const latestDocs = latestPerType(docs);

      if (!isRequiredDocumentSetComplete(latestDocs.map((d) => d.docType))) {
        throw new ValidationError(
          "Conjunto incompleto: envie Invoice, Packing List e BL antes de processar",
        );
      }

      for (const doc of latestDocs) {
        if (doc.status === "extracted") continue;
        await this.extractOne(input.tenantId, doc.id);
      }

      const extracted = await this.deps.extractions.latestByImport(
        input.tenantId,
        input.importId,
      );
      const extractions = extracted.map((e) => e.payload);

      const findings = await this.analyze(input.tenantId, extractions);
      const matches = await this.matchProducts(
        input.tenantId,
        input.importId,
        extractions,
      );

      await this.deps.analyses.replaceForImport(input.tenantId, input.importId, [
        {
          tenantId: input.tenantId,
          importId: input.importId,
          analysisType: "comparison",
          findings,
          severity: worstSeverity(findings),
        },
      ]);

      await imports.updateStatus(
        input.tenantId,
        input.importId,
        "awaiting_review",
      );

      return {
        importId: input.importId,
        extractedDocuments: extracted.length,
        findingsCount: findings.length,
        matchesCount: matches.length,
      };
    } catch (error) {
      await imports.updateStatus(input.tenantId, input.importId, "uploaded");
      throw error;
    }
  }

  private async extractOne(tenantId: string, documentId: string): Promise<void> {
    const { documents, storage, documentAI, extractions, aiLogs } = this.deps;
    const doc = await documents.findById(tenantId, documentId);
    if (!doc) throw new NotFoundError("Documento", documentId);

    const startedAt = Date.now();
    try {
      const bytes = await storage.download(doc.storagePath);
      const result = await documentAI.extractDocument({
        file: {
          data: bytes,
          mimeType: doc.contentType ?? "application/pdf",
          filename: doc.originalFilename ?? "document.pdf",
        },
        docType: doc.docType,
      });

      await extractions.insert({
        documentId: doc.id,
        tenantId,
        model: result.model,
        payload: result.extraction,
        confidence: result.confidence,
        tokensUsed: result.usage.tokensIn + result.usage.tokensOut,
      });
      await documents.updateStatus(tenantId, doc.id, "extracted");
      await aiLogs.insert({
        tenantId,
        capability: "ocr-extraction",
        model: result.model,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        latencyMs: result.usage.latencyMs,
        status: "success",
      });
    } catch (error) {
      await documents.updateStatus(tenantId, doc.id, "failed");
      await aiLogs.insert({
        tenantId,
        capability: "ocr-extraction",
        model: "unknown",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startedAt,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async analyze(
    tenantId: string,
    extractions: DocumentExtraction[],
  ): Promise<Finding[]> {
    const deterministic = compareExtractions(extractions);

    try {
      const ai = await this.deps.documentAI.compareDocuments({ extractions });
      await this.deps.aiLogs.insert({
        tenantId,
        capability: "document-comparison",
        model: ai.model,
        tokensIn: ai.usage.tokensIn,
        tokensOut: ai.usage.tokensOut,
        latencyMs: ai.usage.latencyMs,
        status: "success",
      });
      return mergeFindings(deterministic, ai.findings);
    } catch {
      // Comparacao deterministica e o piso minimo; falha da IA nao bloqueia.
      return deterministic;
    }
  }

  private async matchProducts(
    tenantId: string,
    importId: string,
    extractions: DocumentExtraction[],
  ): Promise<Array<Omit<ProductMatch, "id" | "createdAt">>> {
    const invoice = extractions.find((e) => e.docType === "invoice");
    if (!invoice) return [];

    const matches: Array<Omit<ProductMatch, "id" | "createdAt">> = [];

    for (const item of invoice.items) {
      const candidates = await this.deps.products.findCandidates(
        tenantId,
        item.description,
        10,
      );
      const bySku = await this.deps.products.findBySku(tenantId, item.sku);
      if (bySku && !candidates.some((c) => c.id === bySku.id)) {
        candidates.unshift(bySku);
      }

      const decision = decideProductMatch(item as ExtractedItem, candidates);

      matches.push({
        tenantId,
        importId,
        productId: decision.product?.id ?? null,
        extractedData: item as ExtractedItem,
        matchStatus: decision.status,
        differences: decision.differences,
      });
    }

    await this.deps.productMatches.replaceForImport(tenantId, importId, matches);
    return matches;
  }
}

function latestPerType(
  docs: Awaited<ReturnType<DocumentRepository["listByImport"]>>,
) {
  const byType = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    const current = byType.get(doc.docType);
    if (!current || doc.version > current.version) {
      byType.set(doc.docType, doc);
    }
  }
  return [...byType.values()];
}

function mergeFindings(a: Finding[], b: Finding[]): Finding[] {
  const seen = new Set<string>();
  const merged: Finding[] = [];
  for (const finding of [...a, ...b]) {
    const key = `${finding.field}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}
