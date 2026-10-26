import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";

type AiLogTokenRow = {
  tokens_in: number | null;
  tokens_out: number | null;
};

export async function persistAiLog(params: {
  tenantId: string;
  capability: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string | null;
  costUsd?: number | null;
  reasoningTokens?: number;
  importId?: string | null;
}): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ai_logs")
      .insert({
        tenant_id: params.tenantId,
        capability: params.capability,
        model: params.model,
        tokens_in: params.tokensIn,
        tokens_out: params.tokensOut,
        latency_ms: params.latencyMs,
        status: params.status,
        error_message: params.errorMessage ?? null,
        cost_usd: params.costUsd ?? null,
        reasoning_tokens: params.reasoningTokens ?? 0,
        import_id: params.importId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[ai_logs] falha ao persistir:", error);
      return null;
    }

    return (data?.id as string | undefined) ?? null;
  } catch (err) {
    console.error("[ai_logs] falha ao persistir:", err);
    return null;
  }
}

/**
 * Soma os tokens (entrada + saída) consumidos pelo tenant no mês corrente UTC.
 * Leitura via RLS: a policy de `ai_logs` restringe ao tenant do usuário.
 */
export async function getMonthlyTokenUsage(
  tenantId: string,
): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("ai_logs")
    .select("tokens_in, tokens_out")
    .eq("tenant_id", tenantId)
    .gte("created_at", startOfMonth);

  if (error) {
    throw new Error(error.message || "Falha ao calcular uso mensal de IA");
  }

  const rows = (data ?? []) as AiLogTokenRow[];
  return rows.reduce(
    (total, row) => total + (row.tokens_in ?? 0) + (row.tokens_out ?? 0),
    0,
  );
}

export async function attachAiLogsToImport(params: {
  tenantId: string;
  importId: string;
  logIds: string[];
}): Promise<void> {
  if (params.logIds.length === 0) return;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ai_logs")
    .update({ import_id: params.importId })
    .eq("tenant_id", params.tenantId)
    .in("id", params.logIds);

  if (error) {
    throw new Error(error.message || "Falha ao vincular logs à importação");
  }
}
