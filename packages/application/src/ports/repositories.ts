import type {
  AnalysisResult,
  AuditLog,
  DocumentExtraction,
  ExtractionConfidence,
  Import,
  ImportDocument,
  ImportStatus,
  NewProduct,
  Product,
  ProductMatch,
} from "@confere/domain";

export interface ImportRepository {
  findById(tenantId: string, id: string): Promise<Import | null>;
  listByTenant(
    tenantId: string,
    options?: { status?: ImportStatus; limit?: number; offset?: number },
  ): Promise<Import[]>;
  insert(
    data: Pick<Import, "tenantId" | "referenceNumber"> &
      Partial<Pick<Import, "supplierName" | "incoterm" | "currency" | "createdBy">>,
  ): Promise<Import>;
  updateStatus(tenantId: string, id: string, status: ImportStatus): Promise<void>;
}

export interface DocumentRepository {
  findById(tenantId: string, id: string): Promise<ImportDocument | null>;
  listByImport(tenantId: string, importId: string): Promise<ImportDocument[]>;
  findLatestVersion(
    tenantId: string,
    importId: string,
    docType: ImportDocument["docType"],
  ): Promise<ImportDocument | null>;
  insert(
    data: Omit<ImportDocument, "id" | "createdAt">,
  ): Promise<ImportDocument>;
  updateStatus(
    tenantId: string,
    id: string,
    status: ImportDocument["status"],
  ): Promise<void>;
  confirmUpload(
    tenantId: string,
    id: string,
    data: { sha256: string; contentType: string; sizeBytes: number },
  ): Promise<void>;
}

export interface ExtractionRepository {
  insert(data: {
    documentId: string;
    tenantId: string;
    model: string;
    payload: DocumentExtraction;
    confidence: ExtractionConfidence;
    tokensUsed: number | null;
  }): Promise<{ id: string }>;
  latestByImport(
    tenantId: string,
    importId: string,
  ): Promise<
    Array<{
      documentId: string;
      docType: ImportDocument["docType"];
      payload: DocumentExtraction;
    }>
  >;
}

export interface AnalysisRepository {
  insert(
    data: Omit<AnalysisResult, "id" | "createdAt">,
  ): Promise<AnalysisResult>;
  replaceForImport(
    tenantId: string,
    importId: string,
    results: Array<Omit<AnalysisResult, "id" | "createdAt">>,
  ): Promise<void>;
  listByImport(tenantId: string, importId: string): Promise<AnalysisResult[]>;
}

export interface ProductRepository {
  findBySku(tenantId: string, sku: string): Promise<Product | null>;
  /** Candidatos para matching fuzzy (pre-filtrados por pg_trgm quando possivel). */
  findCandidates(
    tenantId: string,
    description: string,
    limit: number,
  ): Promise<Product[]>;
  listByTenant(
    tenantId: string,
    options?: { query?: string; limit?: number; offset?: number },
  ): Promise<Product[]>;
  insert(data: NewProduct): Promise<Product>;
  update(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<Product, "description" | "ncm" | "unitWeight" | "unitOfMeasure" | "attributes">
    >,
  ): Promise<Product>;
}

export interface ProductMatchRepository {
  replaceForImport(
    tenantId: string,
    importId: string,
    matches: Array<Omit<ProductMatch, "id" | "createdAt">>,
  ): Promise<void>;
  listByImport(tenantId: string, importId: string): Promise<ProductMatch[]>;
}

export interface AuditRepository {
  insert(
    data: Omit<AuditLog, "id" | "createdAt">,
  ): Promise<void>;
  listByTenant(
    tenantId: string,
    options?: { entity?: string; limit?: number; offset?: number },
  ): Promise<AuditLog[]>;
}

export interface AILogRepository {
  insert(data: {
    tenantId: string;
    capability: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    status: "success" | "error";
    errorMessage?: string | null;
  }): Promise<void>;
}

export interface TenantSettingsRepository {
  get(tenantId: string): Promise<{
    validationRules: Record<string, unknown>;
    aiOverrides: Record<string, { provider: string; model: string }>;
    confidenceThreshold: number;
  } | null>;
}

/** Executa multiplas operacoes de repositorio em uma unica transacao. */
export interface UnitOfWork {
  run<T>(fn: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}

export interface UnitOfWorkRepositories {
  imports: ImportRepository;
  documents: DocumentRepository;
  extractions: ExtractionRepository;
  analyses: AnalysisRepository;
  products: ProductRepository;
  productMatches: ProductMatchRepository;
  audit: AuditRepository;
}
