import type { DocumentType } from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
