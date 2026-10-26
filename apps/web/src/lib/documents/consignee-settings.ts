import "server-only";

import type { ConsigneeDefault } from "@/lib/documents/consignee-check";
import { parsePartyAddress } from "@/lib/documents/parties-shared";
import { getReadClient } from "@/lib/supabase/read-client";

export type { ConsigneeDefault } from "@/lib/documents/consignee-check";

export type TenantPartyOption = {
  id: string;
  name: string;
  cnpj: string;
};

const DEFAULT_CONSIGNEE_PARTY_SELECT =
  "id, name, cnpj, street, street_number, complement, postal_code, city, state, country, other_info";

const PARTY_OPTION_SELECT = "id, name, cnpj";

const NOT_FOUND_MESSAGE = "Configurações do tenant não encontradas";

/** Consignee padrão do tenant: a party sempre usada nas importações. */
export async function getDefaultConsignee(
  tenantId: string,
): Promise<ConsigneeDefault | null> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("default_consignee_party_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao ler configurações do tenant");
  }

  const partyId = data?.default_consignee_party_id ?? null;
  if (!partyId) return null;

  const { data: party, error: partyError } = await supabase
    .from("parties")
    .select(DEFAULT_CONSIGNEE_PARTY_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", partyId)
    .maybeSingle();

  if (partyError) {
    throw new Error(partyError.message || "Falha ao buscar consignee padrão");
  }
  if (!party) return null;

  return {
    id: party.id,
    name: party.name,
    cnpj: party.cnpj,
    address: parsePartyAddress(party),
  };
}

/** Alias semântico para quem só precisa do snapshot (nome/CNPJ/endereço + id). */
export function getDefaultConsigneeSnapshot(
  tenantId: string,
): Promise<ConsigneeDefault | null> {
  return getDefaultConsignee(tenantId);
}

/** Define (ou remove, com `null`) o consignee padrão do tenant. */
export async function setDefaultConsignee(
  tenantId: string,
  partyId: string | null,
): Promise<void> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .update({ default_consignee_party_id: partyId })
    .eq("tenant_id", tenantId)
    .select("tenant_id");

  if (error) {
    throw new Error(error.message || "Falha ao salvar consignee padrão");
  }
  if (!data || data.length === 0) {
    throw new Error(NOT_FOUND_MESSAGE);
  }
}

/** Opções de empresa para o seletor de consignee padrão (máximo 200). */
export async function listTenantPartyOptions(
  tenantId: string,
): Promise<TenantPartyOption[]> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("parties")
    .select(PARTY_OPTION_SELECT)
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true })
    .limit(200);

  if (error) {
    throw new Error(error.message || "Falha ao listar empresas");
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    cnpj: row.cnpj,
  }));
}
