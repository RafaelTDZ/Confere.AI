import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function persistAiLog(params: {
  tenantId: string;
  capability: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("ai_logs").insert({
      tenant_id: params.tenantId,
      capability: params.capability,
      model: params.model,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      latency_ms: params.latencyMs,
      status: params.status,
      error_message: params.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[ai_logs] falha ao persistir:", err);
  }
}
