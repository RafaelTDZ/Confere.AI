import type { BlExtraction, InvoiceExtraction } from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ImportNotFoundError } from "@/lib/documents/parties";
import {
  displayImportReference,
  fallbackSavedReference,
  normalizeImportKey,
  type ImportDetail,
  type ImportDocumentRow,
  type ImportPartySummary,
  type ImportRow,
  type ImportStatus,
} from "@/lib/documents/imports-shared";
import {
  listImportStoragePaths,
  moveDocumentsToImport,
} from "@/lib/documents/documents";

export type {
  ImportDetail,
  ImportRow,
  ImportStatus,
} from "@/lib/documents/imports-shared";

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConflictError";
  }
}

const IMPORT_LIST_SELECT =
  "id, reference_number, status, supplier_name, invoice_number, bl_number, created_at";

const IMPORT_DETAIL_SELECT = `${IMPORT_LIST_SELECT}, updated_at, consignee_id, notify_id`;

const REFERENCE_MAX_LENGTH = 120;

function parseReferenceNumber(value: string): string | null {
  const reference = normalizeImportKey(value);
  if (!reference) return null;
  if (reference.length > REFERENCE_MAX_LENGTH) {
    throw new ImportValidationError(
      `Referência deve ter no máximo ${REFERENCE_MAX_LENGTH} caracteres`,
    );
  }
  return reference;
}

type ImportLookupRow = {
  id: string;
  reference_number: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  bl_number: string | null;
};

async function findImportByColumn(
  tenantId: string,
  column: "bl_number" | "invoice_number" | "reference_number",
  value: string,
): Promise<ImportLookupRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .select(
      "id, reference_number, supplier_name, invoice_number, bl_number",
    )
    .eq("tenant_id", tenantId)
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar importação");
  }

  return data as ImportLookupRow | null;
}

async function findImportByKeys(params: {
  tenantId: string;
  invoiceNumber: string | null;
  blNumber: string | null;
}): Promise<ImportLookupRow | null> {
  if (params.blNumber) {
    const byBl = await findImportByColumn(
      params.tenantId,
      "bl_number",
      params.blNumber,
    );
    if (byBl) return byBl;
  }
  if (params.invoiceNumber) {
    const byInvoice = await findImportByColumn(
      params.tenantId,
      "invoice_number",
      params.invoiceNumber,
    );
    if (byInvoice) return byInvoice;
  }
  return null;
}

/**
 * Lista imports do tenant.
 * Usa service role + tenant_id do JWT (mesmo padrão de /api/ai/analyze)
 * porque o grant EXECUTE em private.* pode ainda não estar no cloud —
 * sem ele, select autenticado falha com permission denied for function
 * current_tenant_id.
 */
export async function listTenantImports(
  tenantId: string,
): Promise<ImportRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .select(IMPORT_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ImportRow[];
}

export async function deleteImportRecord(
  tenantId: string,
  importId: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const storagePaths = [
    ...new Set(
      await listImportStoragePaths({
        tenantId,
        importId,
      }),
    ),
  ];
  const { data, error } = await admin
    .from("imports")
    .delete()
    .eq("id", importId)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao remover importação");
  }
  if (!data) {
    throw new ImportNotFoundError();
  }

  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage
      .from("import-documents")
      .remove(storagePaths);
    if (storageError) {
      console.error(
        "[imports delete] Falha ao remover arquivos do Storage",
        storageError,
      );
    }
  }
}

async function createImportRecord(params: {
  tenantId: string;
  userId: string;
  invoiceNumber?: string | null;
  blNumber?: string | null;
  supplierName?: string | null;
}): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .insert({
      tenant_id: params.tenantId,
      reference_number: null,
      status: "processing",
      created_by: params.userId,
      invoice_number: params.invoiceNumber ?? null,
      bl_number: params.blNumber ?? null,
      supplier_name: params.supplierName?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Falha ao criar importação");
  }
  return data.id as string;
}

export async function fillImportKeysIfEmpty(params: {
  importId: string;
  invoiceNumber?: string | null;
  blNumber?: string | null;
  supplierName?: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .select("invoice_number, bl_number, supplier_name")
    .eq("id", params.importId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar importação");
  }
  if (!data) return;

  const patch: Record<string, string> = {};
  if (!data.invoice_number && params.invoiceNumber) {
    patch.invoice_number = params.invoiceNumber;
  }
  if (!data.bl_number && params.blNumber) {
    patch.bl_number = params.blNumber;
  }
  if (!data.supplier_name && params.supplierName) {
    patch.supplier_name = params.supplierName;
  }

  if (Object.keys(patch).length === 0) return;

  const { error: updateError } = await admin
    .from("imports")
    .update(patch)
    .eq("id", params.importId);

  if (updateError) {
    throw new Error(updateError.message || "Falha ao atualizar chaves da importação");
  }
}

export async function clearAutoReferenceIfNeeded(importId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .select("reference_number, invoice_number, bl_number")
    .eq("id", importId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar referência da importação");
  }
  if (!data?.reference_number) return;
  if (displayImportReference(data) !== "") return;

  const { error: updateError } = await admin
    .from("imports")
    .update({ reference_number: null })
    .eq("id", importId);

  if (updateError) {
    throw new Error(updateError.message || "Falha ao limpar referência automática");
  }
}

export async function findOrCreateImport(params: {
  tenantId: string;
  userId: string;
  invoiceNumber: string | null;
  blNumber: string | null;
  supplierName: string | null;
}): Promise<{ importId: string; created: boolean }> {
  const existing = await findImportByKeys(params);
  if (existing) {
    await fillImportKeysIfEmpty({
      importId: existing.id,
      invoiceNumber: params.invoiceNumber,
      blNumber: params.blNumber,
      supplierName: params.supplierName,
    });
    await clearAutoReferenceIfNeeded(existing.id);
    await updateImportStatus(existing.id, "processing");
    return { importId: existing.id, created: false };
  }

  const importId = await createImportRecord(params);
  return { importId, created: true };
}

export async function updateImportStatus(
  importId: string,
  status: ImportStatus,
  extra?: { supplierName?: string | null },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({
      status,
      ...(extra?.supplierName != null
        ? { supplier_name: extra.supplierName }
        : {}),
    })
    .eq("id", importId);

  if (error) {
    throw new Error(error.message || "Falha ao atualizar importação");
  }
}

async function getPartySummary(
  tenantId: string,
  partyId: string | null,
): Promise<ImportPartySummary | null> {
  if (!partyId) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("parties")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", partyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar parte da importação");
  }
  if (!data) return null;
  return { id: data.id as string, name: data.name as string };
}

export async function getImportDetail(
  tenantId: string,
  id: string,
): Promise<ImportDetail> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .select(IMPORT_DETAIL_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao carregar importação");
  }
  if (!data) {
    throw new ImportNotFoundError();
  }

  const { data: documents, error: docsError } = await admin
    .from("documents")
    .select("id, doc_type, original_filename, status, version, created_at")
    .eq("import_id", id)
    .order("created_at", { ascending: true });

  if (docsError) {
    throw new Error(docsError.message || "Falha ao listar documentos");
  }

  const invoiceDocIds = (documents ?? [])
    .filter((row) => row.doc_type === "invoice")
    .map((row) => row.id as string);
  const blDocIds = (documents ?? [])
    .filter((row) => row.doc_type === "bill_of_lading")
    .map((row) => row.id as string);

  async function latestExtractionPayload<T>(
    documentIds: string[],
  ): Promise<T | null> {
    if (documentIds.length === 0) return null;
    const { data: extraction, error: extractionError } = await admin
      .from("extraction_results")
      .select("payload")
      .in("document_id", documentIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (extractionError) {
      throw new Error(extractionError.message || "Falha ao buscar extração");
    }
    return (extraction?.payload as T | undefined) ?? null;
  }

  const [invoice, bl] = await Promise.all([
    latestExtractionPayload<InvoiceExtraction>(invoiceDocIds),
    latestExtractionPayload<BlExtraction>(blDocIds),
  ]);

  const [consignee, notify] = await Promise.all([
    getPartySummary(tenantId, (data.consignee_id as string | null) ?? null),
    getPartySummary(tenantId, (data.notify_id as string | null) ?? null),
  ]);

  return {
    id: data.id as string,
    reference_number: (data.reference_number as string | null) ?? null,
    status: data.status as string,
    supplier_name: (data.supplier_name as string | null) ?? null,
    invoice_number: (data.invoice_number as string | null) ?? null,
    bl_number: (data.bl_number as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
    consignee,
    notify,
    documents: ((documents ?? []) as ImportDocumentRow[]),
    invoice,
    bl,
  };
}

export async function updateImportRecord(
  tenantId: string,
  id: string,
  params: { referenceNumber: string; supplierName?: string | null },
): Promise<ImportDetail> {
  const current = await getImportDetail(tenantId, id);

  const typedReference = parseReferenceNumber(params.referenceNumber);
  const referenceNumber =
    typedReference ??
    fallbackSavedReference({
      blNumber: current.bl_number,
      invoiceNumber: current.invoice_number,
    });
  const supplierName =
    params.supplierName === undefined
      ? undefined
      : params.supplierName?.trim() || null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({
      reference_number: referenceNumber,
      ...(supplierName !== undefined
        ? { supplier_name: supplierName }
        : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error?.code === "23505" && referenceNumber) {
    const existing = await findImportByColumn(
      tenantId,
      "reference_number",
      referenceNumber,
    );
    if (!existing || existing.id === id) {
      throw new ImportConflictError(
        "Já existe uma importação com esta referência",
      );
    }
    return mergeImportInto(tenantId, id, existing.id, {
      supplierName,
    });
  }
  if (error) {
    throw new Error(error.message || "Falha ao atualizar importação");
  }

  return getImportDetail(tenantId, id);
}

async function mergeImportInto(
  tenantId: string,
  sourceId: string,
  targetId: string,
  extras?: { supplierName?: string | null },
): Promise<ImportDetail> {
  if (sourceId === targetId) {
    return getImportDetail(tenantId, targetId);
  }

  const admin = createSupabaseAdminClient();
  const { data: source, error: sourceError } = await admin
    .from("imports")
    .select(
      "invoice_number, bl_number, supplier_name, consignee_id, notify_id",
    )
    .eq("tenant_id", tenantId)
    .eq("id", sourceId)
    .maybeSingle();

  if (sourceError) {
    throw new Error(sourceError.message || "Falha ao buscar importação origem");
  }
  if (!source) {
    throw new ImportNotFoundError();
  }

  const { data: target, error: targetError } = await admin
    .from("imports")
    .select("consignee_id, notify_id")
    .eq("tenant_id", tenantId)
    .eq("id", targetId)
    .maybeSingle();

  if (targetError) {
    throw new Error(targetError.message || "Falha ao buscar importação destino");
  }
  if (!target) {
    throw new ImportNotFoundError();
  }

  await moveDocumentsToImport({
    sourceImportId: sourceId,
    targetImportId: targetId,
  });

  const { error: analysisError } = await admin
    .from("analysis_results")
    .update({ import_id: targetId })
    .eq("import_id", sourceId);
  if (analysisError) {
    throw new Error(
      analysisError.message || "Falha ao mover resultados da análise",
    );
  }

  const { error: matchesError } = await admin
    .from("product_matches")
    .update({ import_id: targetId })
    .eq("import_id", sourceId);
  if (matchesError) {
    throw new Error(
      matchesError.message || "Falha ao mover correspondências de produto",
    );
  }

  await fillImportKeysIfEmpty({
    importId: targetId,
    invoiceNumber: source.invoice_number as string | null,
    blNumber: source.bl_number as string | null,
    supplierName:
      extras?.supplierName !== undefined
        ? extras.supplierName
        : (source.supplier_name as string | null),
  });

  const partyPatch: Record<string, string> = {};
  if (!target.consignee_id && source.consignee_id) {
    partyPatch.consignee_id = source.consignee_id as string;
  }
  if (!target.notify_id && source.notify_id) {
    partyPatch.notify_id = source.notify_id as string;
  }
  if (Object.keys(partyPatch).length > 0) {
    const { error: partyError } = await admin
      .from("imports")
      .update(partyPatch)
      .eq("id", targetId);
    if (partyError) {
      throw new Error(partyError.message || "Falha ao copiar partes");
    }
  }

  const { error: deleteError } = await admin
    .from("imports")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", sourceId);
  if (deleteError) {
    throw new Error(deleteError.message || "Falha ao remover importação duplicada");
  }

  return getImportDetail(tenantId, targetId);
}
