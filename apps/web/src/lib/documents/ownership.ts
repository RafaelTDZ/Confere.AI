import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function assertDocumentOwnership(params: {
  tenantId: string;
  documentId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("documents")
    .select("id")
    .eq("id", params.documentId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao validar documento");
  }
  if (!data) {
    throw new Error("Documento não pertence ao tenant");
  }
}
