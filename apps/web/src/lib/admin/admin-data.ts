import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TENANT_LIST_LIMIT = 100;
const DETAIL_LIST_LIMIT = 50;

export type AdminTenantSummary = {
  id: string;
  name: string;
  created_at: string;
  imports: number;
  documents: number;
  parties: number;
  ncms: number;
  aiTokens: number;
  aiCostUsd: number;
};

export type AdminTenantDetail = {
  tenant: { id: string; name: string; created_at: string };
  counts: {
    imports: number;
    documents: number;
    parties: number;
    ncms: number;
    aiLogs: number;
  };
  imports: Array<{
    id: string;
    reference_number: string | null;
    status: string;
    supplier_name: string | null;
    invoice_number: string | null;
    bl_number: string | null;
    created_at: string;
  }>;
  parties: Array<{
    id: string;
    name: string;
    cnpj: string;
    city: string | null;
    state: string | null;
    created_at: string;
  }>;
  ncms: Array<{
    id: string;
    code: string;
    description: string;
    updated_at: string;
  }>;
  aiLogs: Array<{
    id: string;
    capability: string;
    model: string;
    status: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
    latency_ms: number;
    import_id: string | null;
    created_at: string;
  }>;
};

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

function toError(context: string, error: { message: string }): Error {
  return new Error(
    `Falha ao ${context}: ${error.message || "erro desconhecido"}`,
  );
}

async function readCount(
  resultPromise: PromiseLike<CountResult>,
  context: string,
): Promise<number> {
  const { count, error } = await resultPromise;
  if (error) throw toError(context, error);
  return count ?? 0;
}

/**
 * Soma tokens e custo de IA do tenant em JS. O PostgREST não expõe agregação
 * tipada para service role, então lemos as colunas e reduzimos.
 */
async function sumTenantAiUsage(
  tenantId: string,
): Promise<{ tokens: number; costUsd: number }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ai_logs")
    .select("tokens_in, tokens_out, cost_usd")
    .eq("tenant_id", tenantId);

  if (error) throw toError("somar uso de IA", error);

  let tokens = 0;
  let costUsd = 0;
  for (const row of data ?? []) {
    tokens += (row.tokens_in ?? 0) + (row.tokens_out ?? 0);
    costUsd += row.cost_usd ?? 0;
  }
  return { tokens, costUsd };
}

/**
 * Lista os tenants da plataforma com contadores agregados.
 * Leitura cross-tenant via service role: use apenas nas páginas de super-admin.
 */
export async function listAdminTenants(): Promise<AdminTenantSummary[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, name, created_at")
    .order("created_at", { ascending: false })
    .limit(TENANT_LIST_LIMIT);

  if (error) throw toError("carregar tenants", error);

  return Promise.all(
    (data ?? []).map(async (tenant) => {
      const [imports, documents, parties, ncms, aiUsage] = await Promise.all([
        readCount(
          admin
            .from("imports")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id),
          "contar importações",
        ),
        readCount(
          admin
            .from("documents")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id),
          "contar documentos",
        ),
        readCount(
          admin
            .from("parties")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id),
          "contar empresas",
        ),
        readCount(
          admin
            .from("ncms")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id),
          "contar NCMs",
        ),
        sumTenantAiUsage(tenant.id),
      ]);

      return {
        ...tenant,
        imports,
        documents,
        parties,
        ncms,
        aiTokens: aiUsage.tokens,
        aiCostUsd: aiUsage.costUsd,
      };
    }),
  );
}

/**
 * Detalhe de um tenant com as últimas linhas de cada área.
 * Retorna `null` quando o tenant não existe.
 */
export async function getAdminTenantDetail(
  tenantId: string,
): Promise<AdminTenantDetail | null> {
  const admin = createSupabaseAdminClient();
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, created_at")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError) throw toError("carregar tenant", tenantError);
  if (!tenant) return null;

  const [
    importsCount,
    documentsCount,
    partiesCount,
    ncmsCount,
    aiLogsCount,
    imports,
    parties,
    ncms,
    aiLogs,
  ] = await Promise.all([
    readCount(
      admin
        .from("imports")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      "contar importações",
    ),
    readCount(
      admin
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      "contar documentos",
    ),
    readCount(
      admin
        .from("parties")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      "contar empresas",
    ),
    readCount(
      admin
        .from("ncms")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      "contar NCMs",
    ),
    readCount(
      admin
        .from("ai_logs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      "contar logs de IA",
    ),
    admin
      .from("imports")
      .select(
        "id, reference_number, status, supplier_name, invoice_number, bl_number, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_LIST_LIMIT),
    admin
      .from("parties")
      .select("id, name, cnpj, city, state, created_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(DETAIL_LIST_LIMIT),
    admin
      .from("ncms")
      .select("id, code, description, updated_at")
      .eq("tenant_id", tenantId)
      .order("code", { ascending: true })
      .limit(DETAIL_LIST_LIMIT),
    admin
      .from("ai_logs")
      .select(
        "id, capability, model, status, tokens_in, tokens_out, cost_usd, latency_ms, import_id, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_LIST_LIMIT),
  ]);

  if (imports.error) throw toError("carregar importações", imports.error);
  if (parties.error) throw toError("carregar empresas", parties.error);
  if (ncms.error) throw toError("carregar NCMs", ncms.error);
  if (aiLogs.error) throw toError("carregar logs de IA", aiLogs.error);

  return {
    tenant,
    counts: {
      imports: importsCount,
      documents: documentsCount,
      parties: partiesCount,
      ncms: ncmsCount,
      aiLogs: aiLogsCount,
    },
    imports: imports.data ?? [],
    parties: parties.data ?? [],
    ncms: ncms.data ?? [],
    aiLogs: aiLogs.data ?? [],
  };
}

/**
 * Registra a visualização de um tenant no painel global.
 * A linha vai para o tenant do próprio admin (`actorTenantId`), para o tenant
 * visitado não enxergar a auditoria. Propaga o erro de insert: a página que
 * chama decide se registra no console e segue (a auditoria não derruba a tela).
 */
export async function recordAdminTenantView(params: {
  actorTenantId: string;
  actorUserId: string;
  viewedTenantId: string;
  path: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: params.actorTenantId,
    user_id: params.actorUserId,
    action: "admin.view_tenant",
    entity: "tenant",
    entity_id: params.viewedTenantId,
    after_state: {
      path: params.path,
      viewed_tenant_id: params.viewedTenantId,
    },
  });

  if (error) throw toError("registrar auditoria", error);
}
