import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  trackingGlobalCreditBudget,
  trackingMonthlyCreditBudget,
} from "@/lib/tracking/config";

/** Período contábil do orçamento: YYYY-MM em UTC. */
function trackingPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getTrackingCreditsUsed(tenantId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tracking_usage")
    .select("credits_used")
    .eq("tenant_id", tenantId)
    .eq("period", trackingPeriod())
    .maybeSingle();

  if (error) {
    console.error("[tracking] falha ao ler consumo de créditos:", error.message);
    return 0;
  }
  return data?.credits_used ?? 0;
}

async function getGlobalCreditsUsed(): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tracking_usage")
    .select("credits_used")
    .eq("period", trackingPeriod());

  if (error) {
    console.error("[tracking] falha ao ler consumo global:", error.message);
    return 0;
  }
  return (data ?? []).reduce(
    (sum, row) => sum + (row.credits_used ?? 0),
    0,
  );
}

/**
 * Reserva créditos antes da chamada externa. O teto é checado por tenant e
 * globalmente; quando estoura, a chamada não acontece.
 */
export async function consumeTrackingCredits(params: {
  tenantId: string;
  credits: number;
}): Promise<boolean> {
  const tenantBudget = trackingMonthlyCreditBudget();
  if (tenantBudget > 0) {
    const used = await getTrackingCreditsUsed(params.tenantId);
    if (used + params.credits > tenantBudget) return false;
  }

  const globalBudget = trackingGlobalCreditBudget();
  if (globalBudget > 0) {
    const used = await getGlobalCreditsUsed();
    if (used + params.credits > globalBudget) return false;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("consume_tracking_credits", {
    p_tenant_id: params.tenantId,
    p_period: trackingPeriod(),
    p_credits: params.credits,
    p_limit: tenantBudget,
  });

  if (error) {
    console.error("[tracking] falha ao registrar créditos:", error.message);
    return false;
  }
  return data === true;
}
