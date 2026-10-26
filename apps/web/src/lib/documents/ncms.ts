import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";
import { normalizeNcmCode } from "@/lib/documents/ncms-shared";

export { formatNcmCode } from "@/lib/documents/ncms-shared";

export class NcmNotFoundError extends Error {
  constructor() {
    super("NCM não encontrada");
    this.name = "NcmNotFoundError";
  }
}

export class NcmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NcmValidationError";
  }
}

export type NcmRow = {
  id: string;
  code: string;
  description: string;
  created_at: string;
  updated_at: string;
};

const NCM_SELECT = "id, code, description, created_at, updated_at";

function validateNcmPayload(params: { code: string; description: string }): {
  code: string;
  description: string;
} {
  const code = normalizeNcmCode(params.code);
  const description = params.description.trim();

  if (code.length < 4 || code.length > 10) {
    throw new NcmValidationError(
      "Código NCM deve ter entre 4 e 10 dígitos",
    );
  }
  if (!description) {
    throw new NcmValidationError("Descrição é obrigatória");
  }

  return { code, description };
}

export async function listTenantNcms(tenantId: string): Promise<NcmRow[]> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("ncms")
    .select(NCM_SELECT)
    .eq("tenant_id", tenantId)
    .order("code", { ascending: true });

  if (error) {
    throw new Error(error.message || "Falha ao listar NCMs");
  }

  return (data ?? []) as NcmRow[];
}

export async function getNcmById(
  tenantId: string,
  id: string,
): Promise<NcmRow> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("ncms")
    .select(NCM_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar NCM");
  }
  if (!data) {
    throw new NcmNotFoundError();
  }

  return data as NcmRow;
}

export async function createNcm(
  tenantId: string,
  params: { code: string; description: string },
): Promise<NcmRow> {
  const payload = validateNcmPayload(params);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ncms")
    .insert({
      tenant_id: tenantId,
      ...payload,
    })
    .select(NCM_SELECT)
    .single();

  if (error?.code === "23505") {
    throw new NcmValidationError("Já existe uma NCM com este código");
  }
  if (error || !data) {
    throw new Error(error?.message || "Falha ao cadastrar NCM");
  }

  return data as NcmRow;
}

export async function updateNcm(
  tenantId: string,
  id: string,
  params: { code: string; description: string },
): Promise<NcmRow> {
  const payload = validateNcmPayload(params);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ncms")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select(NCM_SELECT)
    .maybeSingle();

  if (error?.code === "23505") {
    throw new NcmValidationError("Já existe uma NCM com este código");
  }
  if (error) {
    throw new Error(error.message || "Falha ao atualizar NCM");
  }
  if (!data) {
    throw new NcmNotFoundError();
  }

  return data as NcmRow;
}
