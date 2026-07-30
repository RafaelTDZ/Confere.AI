import type {
  AnalysisResult,
  AuditLog,
  DocumentExtraction,
  ExtractedItem,
  FieldDifference,
  Finding,
  ExtractionConfidence,
  Import,
  ImportDocument,
  Product,
  ProductMatch,
} from "@confere/domain";
import type { schema } from "@confere/database";

type Row<T> = T;

export function toImport(
  row: Row<typeof schema.imports.$inferSelect>,
): Import {
  return {
    id: row.id,
    tenantId: row.tenantId,
    referenceNumber: row.referenceNumber,
    status: row.status,
    supplierName: row.supplierName,
    incoterm: row.incoterm,
    currency: row.currency,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toDocument(
  row: Row<typeof schema.documents.$inferSelect>,
): ImportDocument {
  return {
    id: row.id,
    importId: row.importId,
    tenantId: row.tenantId,
    docType: row.docType,
    storagePath: row.storagePath,
    sha256: row.sha256,
    version: row.version,
    status: row.status,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

export function toProduct(
  row: Row<typeof schema.products.$inferSelect>,
): Product {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sku: row.sku,
    description: row.description,
    ncm: row.ncm,
    unitWeight: row.unitWeight == null ? null : Number(row.unitWeight),
    unitOfMeasure: row.unitOfMeasure,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAnalysisResult(
  row: Row<typeof schema.analysisResults.$inferSelect>,
): AnalysisResult {
  return {
    id: row.id,
    importId: row.importId,
    tenantId: row.tenantId,
    analysisType: row.analysisType,
    findings: (row.findings ?? []) as Finding[],
    severity: row.severity,
    createdAt: row.createdAt,
  };
}

export function toProductMatch(
  row: Row<typeof schema.productMatches.$inferSelect>,
): ProductMatch {
  return {
    id: row.id,
    importId: row.importId,
    tenantId: row.tenantId,
    productId: row.productId,
    extractedData: row.extractedData as ExtractedItem,
    matchStatus: row.matchStatus,
    differences: (row.differences ?? []) as FieldDifference[],
    createdAt: row.createdAt,
  };
}

export function toAuditLog(
  row: Row<typeof schema.auditLogs.$inferSelect>,
): AuditLog {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    beforeState: row.beforeState as Record<string, unknown> | null,
    afterState: row.afterState as Record<string, unknown> | null,
    createdAt: row.createdAt,
  };
}

export function toExtractionPayload(payload: unknown): DocumentExtraction {
  return payload as DocumentExtraction;
}

export function toConfidence(payload: unknown): ExtractionConfidence {
  return payload as ExtractionConfidence;
}
