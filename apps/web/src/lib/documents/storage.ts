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
