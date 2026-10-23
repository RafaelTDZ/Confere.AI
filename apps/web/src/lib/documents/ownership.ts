import { getReadClient } from "@/lib/supabase/read-client";

export async function assertDocumentOwnership(params: {
  tenantId: string;
  documentId: string;
}): Promise<void> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
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
