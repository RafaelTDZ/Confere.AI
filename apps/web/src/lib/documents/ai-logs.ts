import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";

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

    return data?.id ?? null;
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

  const rows = data ?? [];
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

export type ImportAiFailure = {
  capability: string;
  message: string;
  createdAt: string;
};

/**
 * Falhas de IA vinculadas à importação (leitura via RLS). A extração de um
 * documento pode falhar sem derrubar a análise; isso alimenta o aviso na tela.
 * Só considera a tentativa mais recente de cada capability — um reprocessamento
 * bem-sucedido esconde o erro antigo.
 */
export async function getImportAiFailures(params: {
  tenantId: string;
  importId: string;
}): Promise<ImportAiFailure[]> {
  try {
    const supabase = await getReadClient();
    const { data, error } = await supabase
      .from("ai_logs")
      .select("capability, status, error_message, created_at")
      .eq("tenant_id", params.tenantId)
      .eq("import_id", params.importId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      console.error("[ai-logs] falha ao ler erros da importação:", error);
      return [];
    }

    const seen = new Set<string>();
    const failures: ImportAiFailure[] = [];

    for (const row of data ?? []) {
      if (seen.has(row.capability)) continue;
      seen.add(row.capability);
      if (row.status !== "error") continue;

      failures.push({
        capability: row.capability,
        message: row.error_message ?? "Falha ao analisar o documento",
        createdAt: row.created_at,
      });
    }

    return failures;
  } catch (error) {
    console.error("[ai-logs] falha inesperada ao ler erros:", error);
    return [];
  }
}
