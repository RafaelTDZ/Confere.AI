import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { Database, schema } from "@confere/database";
import type {
  AnalysisRepository,
  AuditRepository,
  DocumentRepository,
  ExtractionRepository,
  ImportRepository,
  ProductMatchRepository,
  ProductRepository,
  TenantSettingsRepository,
  AILogRepository,
} from "@confere/application";
import type {
  Import,
  ImportDocument,
  ImportStatus,
  NewProduct,
  Product,
} from "@confere/domain";
import {
  toAnalysisResult,
  toAuditLog,
  toDocument,
  toImport,
  toProduct,
  toProductMatch,
} from "./mappers.js";

type Tables = typeof schema;

export class DrizzleImportRepository implements ImportRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async findById(tenantId: string, id: string): Promise<Import | null> {
    const rows = await this.db
      .select()
      .from(this.t.imports)
      .where(
        and(eq(this.t.imports.id, id), eq(this.t.imports.tenantId, tenantId)),
      )
      .limit(1);
    return rows[0] ? toImport(rows[0]) : null;
  }

  async listByTenant(
    tenantId: string,
    options: { status?: ImportStatus; limit?: number; offset?: number } = {},
  ): Promise<Import[]> {
    const conditions = [eq(this.t.imports.tenantId, tenantId)];
    if (options.status) {
      conditions.push(eq(this.t.imports.status, options.status));
    }
    const rows = await this.db
      .select()
      .from(this.t.imports)
      .where(and(...conditions))
      .orderBy(desc(this.t.imports.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
    return rows.map(toImport);
  }

  async insert(
    data: Pick<Import, "tenantId" | "referenceNumber"> &
      Partial<
        Pick<Import, "supplierName" | "incoterm" | "currency" | "createdBy">
      >,
  ): Promise<Import> {
    const rows = await this.db
      .insert(this.t.imports)
      .values({
        tenantId: data.tenantId,
        referenceNumber: data.referenceNumber,
        supplierName: data.supplierName ?? null,
        incoterm: data.incoterm ?? null,
        currency: data.currency ?? null,
        createdBy: data.createdBy ?? null,
      })
      .returning();
    return toImport(rows[0]!);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: ImportStatus,
  ): Promise<void> {
    await this.db
      .update(this.t.imports)
      .set({ status, updatedAt: new Date() })
      .where(
        and(eq(this.t.imports.id, id), eq(this.t.imports.tenantId, tenantId)),
      );
  }
}

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async findById(
    tenantId: string,
    id: string,
  ): Promise<ImportDocument | null> {
    const rows = await this.db
      .select()
      .from(this.t.documents)
      .where(
        and(
          eq(this.t.documents.id, id),
          eq(this.t.documents.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async listByImport(
    tenantId: string,
    importId: string,
  ): Promise<ImportDocument[]> {
    const rows = await this.db
      .select()
      .from(this.t.documents)
      .where(
        and(
          eq(this.t.documents.importId, importId),
          eq(this.t.documents.tenantId, tenantId),
        ),
      )
      .orderBy(this.t.documents.docType, desc(this.t.documents.version));
    return rows.map(toDocument);
  }

  async findLatestVersion(
    tenantId: string,
    importId: string,
    docType: ImportDocument["docType"],
  ): Promise<ImportDocument | null> {
    const rows = await this.db
      .select()
      .from(this.t.documents)
      .where(
        and(
          eq(this.t.documents.importId, importId),
          eq(this.t.documents.tenantId, tenantId),
          eq(this.t.documents.docType, docType),
        ),
      )
      .orderBy(desc(this.t.documents.version))
      .limit(1);
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async insert(
    data: Omit<ImportDocument, "id" | "createdAt">,
  ): Promise<ImportDocument> {
    const rows = await this.db
      .insert(this.t.documents)
      .values(data)
      .returning();
    return toDocument(rows[0]!);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: ImportDocument["status"],
  ): Promise<void> {
    await this.db
      .update(this.t.documents)
      .set({ status })
      .where(
        and(
          eq(this.t.documents.id, id),
          eq(this.t.documents.tenantId, tenantId),
        ),
      );
  }

  async confirmUpload(
    tenantId: string,
    id: string,
    data: { sha256: string; contentType: string; sizeBytes: number },
  ): Promise<void> {
    await this.db
      .update(this.t.documents)
      .set({
        sha256: data.sha256,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
      })
      .where(
        and(
          eq(this.t.documents.id, id),
          eq(this.t.documents.tenantId, tenantId),
        ),
      );
  }
}

export class DrizzleExtractionRepository implements ExtractionRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async insert(data: {
    documentId: string;
    tenantId: string;
    model: string;
    payload: Parameters<ExtractionRepository["insert"]>[0]["payload"];
    confidence: Parameters<ExtractionRepository["insert"]>[0]["confidence"];
    tokensUsed: number | null;
  }): Promise<{ id: string }> {
    const rows = await this.db
      .insert(this.t.extractionResults)
      .values({
        documentId: data.documentId,
        tenantId: data.tenantId,
        model: data.model,
        payload: data.payload,
        confidence: data.confidence,
        tokensUsed: data.tokensUsed,
      })
      .returning({ id: this.t.extractionResults.id });
    return { id: rows[0]!.id };
  }

  async latestByImport(
    tenantId: string,
    importId: string,
  ): Promise<
    Array<{
      documentId: string;
      docType: ImportDocument["docType"];
      payload: Parameters<ExtractionRepository["insert"]>[0]["payload"];
    }>
  > {
    const rows = await this.db
      .selectDistinctOn([this.t.documents.docType], {
        documentId: this.t.documents.id,
        docType: this.t.documents.docType,
        payload: this.t.extractionResults.payload,
      })
      .from(this.t.extractionResults)
      .innerJoin(
        this.t.documents,
        eq(this.t.extractionResults.documentId, this.t.documents.id),
      )
      .where(
        and(
          eq(this.t.documents.importId, importId),
          eq(this.t.extractionResults.tenantId, tenantId),
        ),
      )
      .orderBy(
        this.t.documents.docType,
        desc(this.t.documents.version),
        desc(this.t.extractionResults.createdAt),
      );

    return rows.map((row) => ({
      documentId: row.documentId,
      docType: row.docType,
      payload: row.payload as Parameters<
        ExtractionRepository["insert"]
      >[0]["payload"],
    }));
  }
}

export class DrizzleAnalysisRepository implements AnalysisRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async insert(
    data: Parameters<AnalysisRepository["insert"]>[0],
  ): ReturnType<AnalysisRepository["insert"]> {
    const rows = await this.db
      .insert(this.t.analysisResults)
      .values(data)
      .returning();
    return toAnalysisResult(rows[0]!);
  }

  async replaceForImport(
    tenantId: string,
    importId: string,
    results: Array<Parameters<AnalysisRepository["insert"]>[0]>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(this.t.analysisResults)
        .where(
          and(
            eq(this.t.analysisResults.importId, importId),
            eq(this.t.analysisResults.tenantId, tenantId),
          ),
        );
      if (results.length > 0) {
        await tx.insert(this.t.analysisResults).values(results);
      }
    });
  }

  async listByImport(tenantId: string, importId: string) {
    const rows = await this.db
      .select()
      .from(this.t.analysisResults)
      .where(
        and(
          eq(this.t.analysisResults.importId, importId),
          eq(this.t.analysisResults.tenantId, tenantId),
        ),
      )
      .orderBy(desc(this.t.analysisResults.createdAt));
    return rows.map(toAnalysisResult);
  }
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async findBySku(tenantId: string, sku: string): Promise<Product | null> {
    const rows = await this.db
      .select()
      .from(this.t.products)
      .where(
        and(
          eq(this.t.products.tenantId, tenantId),
          sql`upper(${this.t.products.sku}) = upper(${sku})`,
        ),
      )
      .limit(1);
    return rows[0] ? toProduct(rows[0]) : null;
  }

  /** Pre-filtro por trigram (pg_trgm) + limite; ranking fino fica no domain. */
  async findCandidates(
    tenantId: string,
    description: string,
    limit: number,
  ): Promise<Product[]> {
    const similarity = sql<number>`similarity(${this.t.products.description}, ${description})`;
    const rows = await this.db
      .select({ product: this.t.products, score: similarity })
      .from(this.t.products)
      .where(
        and(
          eq(this.t.products.tenantId, tenantId),
          sql`${similarity} > 0.15`,
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);
    return rows.map((row) => toProduct(row.product));
  }

  async listByTenant(
    tenantId: string,
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<Product[]> {
    const conditions = [eq(this.t.products.tenantId, tenantId)];
    if (options.query) {
      conditions.push(ilike(this.t.products.description, `%${options.query}%`));
    }
    const rows = await this.db
      .select()
      .from(this.t.products)
      .where(and(...conditions))
      .orderBy(this.t.products.sku)
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
    return rows.map(toProduct);
  }

  async insert(data: NewProduct): Promise<Product> {
    const rows = await this.db
      .insert(this.t.products)
      .values({
        tenantId: data.tenantId,
        sku: data.sku,
        description: data.description,
        ncm: data.ncm ?? null,
        unitWeight:
          data.unitWeight == null ? null : String(data.unitWeight),
        unitOfMeasure: data.unitOfMeasure ?? null,
        attributes: data.attributes ?? {},
        origin: data.origin,
      })
      .returning();
    return toProduct(rows[0]!);
  }

  async update(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<
        Product,
        "description" | "ncm" | "unitWeight" | "unitOfMeasure" | "attributes"
      >
    >,
  ): Promise<Product> {
    const rows = await this.db
      .update(this.t.products)
      .set({
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.ncm !== undefined ? { ncm: data.ncm } : {}),
        ...(data.unitWeight !== undefined
          ? { unitWeight: data.unitWeight == null ? null : String(data.unitWeight) }
          : {}),
        ...(data.unitOfMeasure !== undefined
          ? { unitOfMeasure: data.unitOfMeasure }
          : {}),
        ...(data.attributes !== undefined
          ? { attributes: data.attributes }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(this.t.products.id, id),
          eq(this.t.products.tenantId, tenantId),
        ),
      )
      .returning();
    return toProduct(rows[0]!);
  }
}

export class DrizzleProductMatchRepository implements ProductMatchRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async replaceForImport(
    tenantId: string,
    importId: string,
    matches: Array<Parameters<ProductMatchRepository["replaceForImport"]>[2][number]>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(this.t.productMatches)
        .where(
          and(
            eq(this.t.productMatches.importId, importId),
            eq(this.t.productMatches.tenantId, tenantId),
          ),
        );
      if (matches.length > 0) {
        await tx.insert(this.t.productMatches).values(
          matches.map((m) => ({
            tenantId: m.tenantId,
            importId: m.importId,
            productId: m.productId,
            extractedData: m.extractedData,
            matchStatus: m.matchStatus,
            differences: m.differences,
          })),
        );
      }
    });
  }

  async listByImport(tenantId: string, importId: string) {
    const rows = await this.db
      .select()
      .from(this.t.productMatches)
      .where(
        and(
          eq(this.t.productMatches.importId, importId),
          eq(this.t.productMatches.tenantId, tenantId),
        ),
      )
      .orderBy(this.t.productMatches.createdAt);
    return rows.map(toProductMatch);
  }
}

export class DrizzleAuditRepository implements AuditRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async insert(
    data: Parameters<AuditRepository["insert"]>[0],
  ): Promise<void> {
    await this.db.insert(this.t.auditLogs).values(data);
  }

  async listByTenant(
    tenantId: string,
    options: { entity?: string; limit?: number; offset?: number } = {},
  ) {
    const conditions = [eq(this.t.auditLogs.tenantId, tenantId)];
    if (options.entity) {
      conditions.push(eq(this.t.auditLogs.entity, options.entity));
    }
    const rows = await this.db
      .select()
      .from(this.t.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(this.t.auditLogs.createdAt))
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);
    return rows.map(toAuditLog);
  }
}

export class DrizzleAILogRepository implements AILogRepository {
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async insert(
    data: Parameters<AILogRepository["insert"]>[0],
  ): Promise<void> {
    await this.db.insert(this.t.aiLogs).values({
      tenantId: data.tenantId,
      capability: data.capability,
      model: data.model,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      latencyMs: data.latencyMs,
      status: data.status,
      errorMessage: data.errorMessage ?? null,
    });
  }
}

export class DrizzleTenantSettingsRepository
  implements TenantSettingsRepository
{
  constructor(
    private readonly db: Database,
    private readonly t: Tables,
  ) {}

  async get(tenantId: string) {
    const rows = await this.db
      .select()
      .from(this.t.tenantSettings)
      .where(eq(this.t.tenantSettings.tenantId, tenantId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      validationRules: row.validationRules as Record<string, unknown>,
      aiOverrides: row.aiOverrides as Record<
        string,
        { provider: string; model: string }
      >,
      confidenceThreshold: Number(row.confidenceThreshold),
    };
  }
}
