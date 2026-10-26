import "server-only";

import type {
  BlExtraction,
  InvoiceExtraction,
  InvoiceParty,
} from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";
import {
  EMPTY_PARTY_ADDRESS,
  formatAddressLine,
  formatCnpj,
  isValidCnpjDigits,
  mergePartyAddress,
  normalizeCnpjDigits,
  parsePartyAddress,
  type PartyAddress,
  type PartyRole,
  type PendingParty,
} from "@/lib/documents/parties-shared";
import {
  buildPage,
  escapeLike,
  normalizePage,
  normalizePageSize,
  normalizeSearch,
  type ListOptions,
  type Page,
} from "@/lib/pagination";

export type { PendingParty } from "@/lib/documents/parties-shared";

export type ImportPartiesState = {
  importId: string;
  pendingParties: PendingParty[];
  linked: boolean;
  invoice: InvoiceExtraction | null;
};

export class PartyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartyValidationError";
  }
}

export class ImportNotFoundError extends Error {
  constructor() {
    super("Importação não encontrada");
    this.name = "ImportNotFoundError";
  }
}

export class PartyNotFoundError extends Error {
  constructor() {
    super("Empresa não encontrada");
    this.name = "PartyNotFoundError";
  }
}

export type PartyRow = {
  id: string;
  name: string;
  cnpj: string;
  address: PartyAddress;
  created_at: string;
  updated_at: string;
};

type PartyTableRow = {
  id: string;
  name: string;
  cnpj: string;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  postal_code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  other_info: string | null;
  created_at: string;
  updated_at: string;
};

const PARTY_SELECT =
  "id, name, cnpj, street, street_number, complement, postal_code, city, state, country, other_info, created_at, updated_at";

function mapPartyRow(row: PartyTableRow): PartyRow {
  return {
    id: row.id,
    name: row.name,
    cnpj: row.cnpj,
    address: parsePartyAddress(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validatePartyPayload(params: {
  name: string;
  cnpj: string;
  address: PartyAddress;
}): { name: string; digits: string; address: PartyAddress } {
  const name = params.name.trim();
  const digits = normalizeCnpjDigits(params.cnpj);
  const address = parsePartyAddress(params.address);

  if (!name) {
    throw new PartyValidationError("Nome é obrigatório");
  }
  if (!isValidCnpjDigits(digits)) {
    throw new PartyValidationError("CNPJ deve ter 14 dígitos");
  }
  if (!address.street) {
    throw new PartyValidationError("Rua é obrigatória");
  }
  if (!address.city) {
    throw new PartyValidationError("Cidade é obrigatória");
  }
  if (!address.state) {
    throw new PartyValidationError("Estado é obrigatório");
  }
  if (!address.country) {
    throw new PartyValidationError("País é obrigatório");
  }

  return { name, digits, address };
}

function partyWriteColumns(params: {
  name: string;
  digits: string;
  address: PartyAddress;
}) {
  return {
    name: params.name,
    cnpj: formatCnpj(params.digits),
    cnpj_digits: params.digits,
    address: formatAddressLine(params.address),
    street: params.address.street,
    street_number: params.address.number,
    complement: params.address.complement,
    postal_code: params.address.postalCode,
    city: params.address.city,
    state: params.address.state,
    country: params.address.country,
    other_info: params.address.other,
  };
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const next = value?.trim() ?? "";
  return next.length > 0 ? next : null;
}

function hasPartyIdentity(party: InvoiceParty): boolean {
  return Boolean(
    trimmedOrNull(party.name) || normalizeCnpjDigits(party.cnpj).length > 0,
  );
}

async function findPartyByCnpj(
  tenantId: string,
  cnpj: string,
): Promise<{ id: string } | null> {
  const digits = normalizeCnpjDigits(cnpj);
  if (!isValidCnpjDigits(digits)) return null;

  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("parties")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("cnpj_digits", digits)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar parte");
  }

  return data?.id ? { id: data.id as string } : null;
}

async function upsertParty(params: {
  tenantId: string;
  name: string;
  cnpj: string;
  address: PartyAddress;
}): Promise<string> {
  const { name, digits, address } = validatePartyPayload(params);

  const existing = await findPartyByCnpj(params.tenantId, digits);
  if (existing) return existing.id;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("parties")
    .insert({
      tenant_id: params.tenantId,
      ...partyWriteColumns({ name, digits, address }),
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    const raced = await findPartyByCnpj(params.tenantId, digits);
    if (raced) return raced.id;
  }

  if (error || !data?.id) {
    throw new Error(error?.message || "Falha ao cadastrar parte");
  }

  return data.id as string;
}

export async function listTenantParties(
  tenantId: string,
  options: ListOptions = {},
): Promise<Page<PartyRow>> {
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const search = normalizeSearch(options.search);
  const from = (page - 1) * pageSize;

  const supabase = await getReadClient();
  let query = supabase
    .from("parties")
    .select(PARTY_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (search) {
    const term = escapeLike(search);
    query = query.or(`name.ilike.%${term}%,cnpj.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1);

  if (error) {
    throw new Error(error.message || "Falha ao listar empresas");
  }

  return buildPage(
    ((data ?? []) as PartyTableRow[]).map(mapPartyRow),
    count ?? 0,
    page,
    pageSize,
  );
}

export async function getPartyById(
  tenantId: string,
  id: string,
): Promise<PartyRow> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("parties")
    .select(PARTY_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar empresa");
  }
  if (!data) {
    throw new PartyNotFoundError();
  }

  return mapPartyRow(data as PartyTableRow);
}

export async function updateParty(
  tenantId: string,
  id: string,
  params: { name: string; cnpj: string; address: PartyAddress },
): Promise<PartyRow> {
  const { name, digits, address } = validatePartyPayload(params);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("parties")
    .update(partyWriteColumns({ name, digits, address }))
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select(PARTY_SELECT)
    .maybeSingle();

  if (error?.code === "23505") {
    throw new PartyValidationError("Já existe empresa com este CNPJ");
  }
  if (error) {
    throw new Error(error.message || "Falha ao atualizar empresa");
  }
  if (!data) {
    throw new PartyNotFoundError();
  }

  return mapPartyRow(data as PartyTableRow);
}

export async function deleteParty(tenantId: string, id: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("parties")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao excluir empresa");
  }
  if (!data) {
    throw new PartyNotFoundError();
  }
}

async function linkImportParties(params: {
  tenantId: string;
  importId: string;
  consigneeId?: string;
  notifyId?: string;
}): Promise<void> {
  const patch: Record<string, string> = {};
  if (params.consigneeId) patch.consignee_id = params.consigneeId;
  if (params.notifyId) patch.notify_id = params.notifyId;
  if (Object.keys(patch).length === 0) return;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update(patch)
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId);

  if (error) {
    throw new Error(error.message || "Falha ao vincular partes à importação");
  }
}

export function combinePendingParties(items: PendingParty[]): PendingParty[] {
  const byCnpj = new Map<string, PendingParty>();
  const withoutCnpj: PendingParty[] = [];

  for (const item of items) {
    const digits = normalizeCnpjDigits(item.cnpj);
    if (!isValidCnpjDigits(digits)) {
      withoutCnpj.push({
        roles: [...item.roles],
        name: item.name,
        cnpj: item.cnpj,
        address: parsePartyAddress(item.address),
      });
      continue;
    }

    const existing = byCnpj.get(digits);
    if (existing) {
      for (const role of item.roles) {
        if (!existing.roles.includes(role)) existing.roles.push(role);
      }
      if (!existing.name && item.name) existing.name = item.name;
      existing.address = mergePartyAddress(
        existing.address,
        parsePartyAddress(item.address),
      );
    } else {
      byCnpj.set(digits, {
        roles: [...item.roles],
        name: item.name,
        cnpj: item.cnpj,
        address: parsePartyAddress(item.address),
      });
    }
  }

  return [...byCnpj.values(), ...withoutCnpj];
}

export function pendingPartiesFromInvoice(
  invoice: InvoiceExtraction,
): PendingParty[] {
  const extracted: Array<{ role: PartyRole; party: InvoiceParty }> = [
    { role: "consignee", party: invoice.importer },
    { role: "notify", party: invoice.notify },
  ];

  const pending: PendingParty[] = [];
  for (const { role, party } of extracted) {
    if (!hasPartyIdentity(party)) continue;
    pending.push({
      roles: [role],
      name: trimmedOrNull(party.name),
      cnpj: trimmedOrNull(party.cnpj),
      address: parsePartyAddress(party.address),
    });
  }

  return combinePendingParties(pending);
}

export function pendingPartiesFromBl(bl: BlExtraction): PendingParty[] {
  const extracted: Array<{ role: PartyRole; party: InvoiceParty }> = [
    {
      role: "consignee",
      party: {
        ...bl.consigneeDetails,
        name: bl.consigneeDetails.name ?? bl.consignee,
      },
    },
    {
      role: "notify",
      party: {
        ...bl.notifyPartyDetails,
        name: bl.notifyPartyDetails.name ?? bl.notifyParty,
      },
    },
  ];

  return combinePendingParties(
    extracted
      .filter(({ party }) => hasPartyIdentity(party))
      .map(({ role, party }) => ({
        roles: [role],
        name: trimmedOrNull(party.name),
        cnpj: trimmedOrNull(party.cnpj),
        address: parsePartyAddress(party.address),
      })),
  );
}

async function resolveExtractedParties(params: {
  tenantId: string;
  importId: string;
  extracted: Array<{ role: PartyRole; party: InvoiceParty }>;
}): Promise<PendingParty[]> {
  const links: { consigneeId?: string; notifyId?: string } = {};
  const pending: PendingParty[] = [];

  for (const { role, party } of params.extracted) {
    if (!hasPartyIdentity(party)) continue;

    const found = await findPartyByCnpj(params.tenantId, party.cnpj ?? "");
    if (found) {
      if (role === "consignee") links.consigneeId = found.id;
      if (role === "notify") links.notifyId = found.id;
      continue;
    }

    pending.push({
      roles: [role],
      name: trimmedOrNull(party.name),
      cnpj: trimmedOrNull(party.cnpj),
      address: parsePartyAddress(party.address),
    });
  }

  await linkImportParties({
    tenantId: params.tenantId,
    importId: params.importId,
    ...links,
  });

  return combinePendingParties(pending);
}

export async function resolveInvoiceParties(params: {
  tenantId: string;
  importId: string;
  invoice: InvoiceExtraction;
}): Promise<PendingParty[]> {
  return resolveExtractedParties({
    tenantId: params.tenantId,
    importId: params.importId,
    extracted: [
      { role: "consignee", party: params.invoice.importer },
      { role: "notify", party: params.invoice.notify },
    ],
  });
}

export async function resolveBlParties(params: {
  tenantId: string;
  importId: string;
  bl: BlExtraction;
}): Promise<PendingParty[]> {
  const extracted: Array<{ role: PartyRole; party: InvoiceParty }> = [
    {
      role: "consignee",
      party: {
        ...params.bl.consigneeDetails,
        name: params.bl.consigneeDetails.name ?? params.bl.consignee,
      },
    },
    {
      role: "notify",
      party: {
        ...params.bl.notifyPartyDetails,
        name: params.bl.notifyPartyDetails.name ?? params.bl.notifyParty,
      },
    },
  ];
  return resolveExtractedParties({
    tenantId: params.tenantId,
    importId: params.importId,
    extracted,
  });
}

async function getImportRow(tenantId: string, importId: string) {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("imports")
    .select("id, consignee_id, notify_id")
    .eq("id", importId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar importação");
  }
  if (!data) {
    throw new ImportNotFoundError();
  }

  return data;
}

async function getInvoiceExtractionForImport(
  importId: string,
): Promise<InvoiceExtraction | null> {
  const supabase = await getReadClient();
  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("id")
    .eq("import_id", importId)
    .eq("doc_type", "invoice");

  if (docsError) {
    throw new Error(docsError.message || "Falha ao buscar documentos");
  }

  const documentIds = (documents ?? []).map((row) => row.id as string);
  if (documentIds.length === 0) return null;

  const { data, error } = await supabase
    .from("extraction_results")
    .select("payload")
    .in("document_id", documentIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar extração");
  }

  return (data?.payload as InvoiceExtraction | undefined) ?? null;
}

async function getBlExtractionForImport(
  importId: string,
): Promise<BlExtraction | null> {
  const supabase = await getReadClient();
  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("id")
    .eq("import_id", importId)
    .eq("doc_type", "bill_of_lading");

  if (docsError) {
    throw new Error(docsError.message || "Falha ao buscar documentos");
  }

  const documentIds = (documents ?? []).map((row) => row.id as string);
  if (documentIds.length === 0) return null;

  const { data, error } = await supabase
    .from("extraction_results")
    .select("payload")
    .in("document_id", documentIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar extração do BL");
  }
  if (!data?.payload) return null;

  const payload = data.payload as Partial<BlExtraction>;
  const emptyAddress = { ...EMPTY_PARTY_ADDRESS };
  return {
    ...payload,
    consigneeDetails: payload.consigneeDetails ?? {
      name: payload.consignee ?? null,
      cnpj: null,
      address: emptyAddress,
    },
    notifyPartyDetails: payload.notifyPartyDetails ?? {
      name: payload.notifyParty ?? null,
      cnpj: null,
      address: emptyAddress,
    },
  } as BlExtraction;
}

export async function getImportPartiesState(
  tenantId: string,
  importId: string,
): Promise<ImportPartiesState> {
  await getImportRow(tenantId, importId);
  const [invoice, bl] = await Promise.all([
    getInvoiceExtractionForImport(importId),
    getBlExtractionForImport(importId),
  ]);
  const pendingFromInvoice = invoice
    ? await resolveInvoiceParties({ tenantId, importId, invoice })
    : [];
  const pendingFromBl = bl
    ? await resolveBlParties({ tenantId, importId, bl })
    : [];
  const pendingParties = combinePendingParties([
    ...pendingFromInvoice,
    ...pendingFromBl,
  ]);
  const refreshed = await getImportRow(tenantId, importId);

  return {
    importId,
    pendingParties,
    linked: Boolean(refreshed.consignee_id || refreshed.notify_id),
    invoice,
  };
}

export async function registerImportParties(params: {
  tenantId: string;
  importId: string;
  parties: PendingParty[];
}): Promise<void> {
  await getImportRow(params.tenantId, params.importId);

  if (params.parties.length === 0) {
    throw new PartyValidationError("Informe ao menos uma parte para cadastrar");
  }

  let consigneeId: string | undefined;
  let notifyId: string | undefined;

  for (const party of params.parties) {
    const roles = [...new Set(party.roles)].filter(
      (role): role is PartyRole => role === "consignee" || role === "notify",
    );
    if (roles.length === 0) {
      throw new PartyValidationError("Papel da parte é inválido");
    }

    const id = await upsertParty({
      tenantId: params.tenantId,
      name: party.name ?? "",
      cnpj: party.cnpj ?? "",
      address: parsePartyAddress(party.address),
    });

    if (roles.includes("consignee")) consigneeId = id;
    if (roles.includes("notify")) notifyId = id;
  }

  await linkImportParties({
    tenantId: params.tenantId,
    importId: params.importId,
    consigneeId,
    notifyId,
  });
}
