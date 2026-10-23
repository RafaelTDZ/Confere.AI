import { assertDocumentOwnership } from "@/lib/documents/ownership";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";

export type LatestExtraction = {
  id: string;
  documentId: string;
  model: string;
  payload: unknown;
  tokensUsed: number | null;
  createdAt: string;
};

export async function findLatestExtractionsByDocumentIds(params: {
  tenantId: string;
  documentIds: string[];
}): Promise<Map<string, LatestExtraction>> {
  if (params.documentIds.length === 0) {
    return new Map();
  }

  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("extraction_results")
    .select("id, document_id, model, payload, tokens_used, created_at")
    .eq("tenant_id", params.tenantId)
    .in("document_id", params.documentIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message || "Falha ao buscar extrações");
  }

  const latest = new Map<string, LatestExtraction>();
  for (const row of data ?? []) {
    const documentId = row.document_id as string;
    if (latest.has(documentId)) continue;
    latest.set(documentId, {
      id: row.id as string,
      documentId,
      model: row.model as string,
      payload: row.payload,
      tokensUsed: (row.tokens_used as number | null) ?? null,
      createdAt: row.created_at as string,
    });
  }
  return latest;
}

export async function persistExtractionResult(params: {
  tenantId: string;
  documentId: string;
  model: string;
  payload: unknown;
  tokensUsed?: number;
}): Promise<string> {
  await assertDocumentOwnership({
    tenantId: params.tenantId,
    documentId: params.documentId,
  });

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
