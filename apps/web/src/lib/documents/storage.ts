import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listImportStoragePaths } from "@/lib/documents/documents";

const BUCKET = "import-documents";

/**
 * Persistência do pipeline de análise.
 * Usa service role (bypassa RLS) porque as policies chamam private.* e o
 * grant EXECUTE para authenticated pode ainda não estar aplicado no cloud.
 * tenant_id / created_by sempre vêm do JWT validado em getAuthContext().
 */

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180);
}

function buildStoragePath(
  tenantId: string,
  importId: string,
  filename: string,
): string {
  return `${tenantId}/${importId}/${sanitizeFilename(filename)}`;
}

function withFilenameSuffix(filename: string, suffix: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return `${filename}-${suffix}`;
  return `${filename.slice(0, lastDot)}-${suffix}${filename.slice(lastDot)}`;
}

export async function buildUniqueStoragePath(params: {
  tenantId: string;
  importId: string;
  filename: string;
  digest: string;
}): Promise<string> {
  const base = buildStoragePath(
    params.tenantId,
    params.importId,
    params.filename,
  );
  const existing = new Set(
    await listImportStoragePaths({
      tenantId: params.tenantId,
      importId: params.importId,
    }),
  );
  if (!existing.has(base)) return base;

  const safe = sanitizeFilename(params.filename);
  let suffix = params.digest.slice(0, 6);
  let next = `${params.tenantId}/${params.importId}/${withFilenameSuffix(safe, suffix)}`;
  let attempt = 2;
  while (existing.has(next)) {
    suffix = `${params.digest.slice(0, 6)}-${attempt}`;
    next = `${params.tenantId}/${params.importId}/${withFilenameSuffix(safe, suffix)}`;
    attempt += 1;
  }
  return next;
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
