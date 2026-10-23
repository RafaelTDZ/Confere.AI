import type { DocumentType } from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";

export type TenantDocumentBySha = {
  id: string;
  docType: DocumentType;
  importId: string;
  storagePath: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  version: number;
  createdAt: string;
};

export async function findTenantDocumentsBySha256(params: {
  tenantId: string;
  sha256: string;
}): Promise<TenantDocumentBySha[]> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, doc_type, import_id, storage_path, original_filename, content_type, size_bytes, status, version, created_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("sha256", params.sha256)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message || "Falha ao buscar documentos");
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    docType: row.doc_type as DocumentType,
    importId: row.import_id as string,
    storagePath: row.storage_path as string,
    filename: (row.original_filename as string | null) ?? "documento",
    mediaType:
      (row.content_type as string | null) ?? "application/octet-stream",
    sizeBytes: (row.size_bytes as number | null) ?? 0,
    status: row.status as string,
    version: row.version as number,
    createdAt: row.created_at as string,
  }));
}

export async function findDocumentsBySha256(params: {
  tenantId: string;
  importId: string;
  sha256: string;
}): Promise<Array<{ id: string; docType: DocumentType }>> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, doc_type")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId)
    .eq("sha256", params.sha256);

  if (error) {
    throw new Error(error.message || "Falha ao buscar documentos");
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    docType: row.doc_type as DocumentType,
  }));
}

async function nextDocumentVersions(
  tenantId: string,
  importId: string,
  types: DocumentType[],
): Promise<Record<DocumentType, number>> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("documents")
    .select("doc_type, version")
    .eq("tenant_id", tenantId)
    .eq("import_id", importId)
    .in("doc_type", types);

  if (error) {
    throw new Error(error.message || "Falha ao versionar documentos");
  }

  const max = {} as Record<DocumentType, number>;
  for (const type of types) {
    max[type] = 0;
  }
  for (const row of data ?? []) {
    const type = row.doc_type as DocumentType;
    max[type] = Math.max(max[type] ?? 0, row.version as number);
  }
  for (const type of types) {
    max[type] += 1;
  }
  return max;
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
  const versions = await nextDocumentVersions(
    params.tenantId,
    params.importId,
    params.types,
  );
  const admin = createSupabaseAdminClient();
  const rows = params.types.map((docType) => ({
    tenant_id: params.tenantId,
    import_id: params.importId,
    doc_type: docType,
    storage_path: params.storagePath,
    sha256: params.sha256,
    version: versions[docType],
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

export async function updateDocumentStatus(params: {
  tenantId: string;
  documentId: string;
  status: "pending" | "extracted" | "failed";
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("documents")
    .update({ status: params.status })
    .eq("id", params.documentId)
    .eq("tenant_id", params.tenantId);

  if (error) {
    throw new Error(error.message || "Falha ao atualizar documento");
  }
}

export async function listImportStoragePaths(params: {
  tenantId: string;
  importId: string;
}): Promise<string[]> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.importId);

  if (error) {
    throw new Error(error.message || "Falha ao listar arquivos da importação");
  }

  return (data ?? []).map((row) => row.storage_path as string);
}

export async function moveDocumentsToImport(params: {
  tenantId: string;
  sourceImportId: string;
  targetImportId: string;
}): Promise<void> {
  if (params.sourceImportId === params.targetImportId) return;

  const read = await getReadClient();
  const admin = createSupabaseAdminClient();
  const { data: sourceDocs, error: sourceError } = await read
    .from("documents")
    .select("id, doc_type")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.sourceImportId)
    .order("created_at", { ascending: true });

  if (sourceError) {
    throw new Error(sourceError.message || "Falha ao listar documentos da origem");
  }
  if (!sourceDocs || sourceDocs.length === 0) return;

  const types = [
    ...new Set(sourceDocs.map((row) => row.doc_type as DocumentType)),
  ];
  const { data: targetDocs, error: targetError } = await read
    .from("documents")
    .select("doc_type, version")
    .eq("tenant_id", params.tenantId)
    .eq("import_id", params.targetImportId)
    .in("doc_type", types);

  if (targetError) {
    throw new Error(targetError.message || "Falha ao versionar documentos no destino");
  }

  const max = {} as Record<DocumentType, number>;
  for (const type of types) {
    max[type] = 0;
  }
  for (const row of targetDocs ?? []) {
    const type = row.doc_type as DocumentType;
    max[type] = Math.max(max[type] ?? 0, row.version as number);
  }

  for (const doc of sourceDocs) {
    const type = doc.doc_type as DocumentType;
    max[type] = (max[type] ?? 0) + 1;
    const { error } = await admin
      .from("documents")
      .update({
        import_id: params.targetImportId,
        version: max[type],
      })
      .eq("id", doc.id)
      .eq("tenant_id", params.tenantId);

    if (error) {
      throw new Error(error.message || "Falha ao mover documento");
    }
  }
}
