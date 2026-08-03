import type { InvoiceExtraction } from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
