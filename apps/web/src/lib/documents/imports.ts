import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ImportStatus =
  | "uploaded"
  | "processing"
  | "awaiting_review"
  | "completed"
  | "rejected";

export type ImportRow = {
  id: string;
  reference_number: string;
  status: string;
  supplier_name: string | null;
  created_at: string;
};

export const IMPORT_STATUS_LABELS: Record<
  string,
  {
    label: string;
    variant:
      | "default"
      | "secondary"
      | "destructive"
      | "success"
      | "warning"
      | "outline";
  }
> = {
  uploaded: { label: "Enviado", variant: "secondary" },
  processing: { label: "Processando", variant: "warning" },
  awaiting_review: { label: "Aguardando revisão", variant: "default" },
  completed: { label: "Concluída", variant: "success" },
  rejected: { label: "Rejeitada", variant: "destructive" },
};

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
    .select("id, reference_number, status, supplier_name, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ImportRow[];
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
