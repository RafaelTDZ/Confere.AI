import type { DocumentType, InvoiceExtraction } from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const BUCKET = "import-documents";

/**
 * Persistência do pipeline de análise.
 * Usa service role (bypassa RLS) porque as policies chamam private.* e o
 * grant EXECUTE para authenticated pode ainda não estar aplicado no cloud.
 * tenant_id / created_by sempre vêm do JWT validado em getAuthContext().
 */

export function buildStoragePath(
  tenantId: string,
  importId: string,
  filename: string,
): string {
  const safe = filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180);
  return `${tenantId}/${importId}/${safe}`;
}

export async function createImportRecord(params: {
  tenantId: string;
  userId: string;
  referenceNumber: string;
}): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .insert({
      tenant_id: params.tenantId,
      reference_number: params.referenceNumber,
      status: "processing",
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Falha ao criar importação");
  }
  return data.id as string;
}

export async function uploadImportFile(params: {
  storagePath: string;
  bytes: Uint8Array;
  mediaType: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(params.storagePath, params.bytes, {
      contentType: params.mediaType,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message || "Falha ao enviar arquivo ao Storage");
  }
}

export async function insertDocuments(params: {
  tenantId: string;
  importId: string;
  types: DocumentType[];
  storagePath: string;
  sha256: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
}): Promise<Array<{ id: string; docType: DocumentType }>> {
  const admin = createSupabaseAdminClient();
  const rows = params.types.map((docType) => ({
    tenant_id: params.tenantId,
    import_id: params.importId,
    doc_type: docType,
    storage_path: params.storagePath,
    sha256: params.sha256,
    version: 1,
    status: "pending" as const,
    original_filename: params.filename,
    content_type: params.mediaType,
    size_bytes: params.sizeBytes,
  }));

  const { data, error } = await admin
    .from("documents")
    .insert(rows)
    .select("id, doc_type");

  if (error || !data) {
    throw new Error(error?.message || "Falha ao registrar documentos");
  }

  return data.map((row) => ({
    id: row.id as string,
    docType: row.doc_type as DocumentType,
  }));
}

export async function updateImportStatus(
  importId: string,
  status: "uploaded" | "processing" | "awaiting_review" | "completed" | "rejected",
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

export async function updateDocumentStatus(
  documentId: string,
  status: "pending" | "extracted" | "failed",
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("documents")
    .update({ status })
    .eq("id", documentId);

  if (error) {
    throw new Error(error.message || "Falha ao atualizar documento");
  }
}

export async function persistExtractionResult(params: {
  tenantId: string;
  documentId: string;
  model: string;
  payload: InvoiceExtraction;
  tokensUsed?: number;
}): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("extraction_results")
    .insert({
      tenant_id: params.tenantId,
      document_id: params.documentId,
      model: params.model,
      payload: params.payload,
      confidence: {},
      tokens_used: params.tokensUsed ?? null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || "Falha ao salvar extração");
  }

  return data.id as string;
}

export async function persistAiLog(params: {
  tenantId: string;
  capability: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("ai_logs").insert({
      tenant_id: params.tenantId,
      capability: params.capability,
      model: params.model,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      latency_ms: params.latencyMs,
      status: params.status,
      error_message: params.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[ai_logs] falha ao persistir:", err);
  }
}
