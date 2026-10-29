import "server-only";

import type {
  BlExtraction,
  DocumentType,
  InvoiceExtraction,
} from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";
import { ImportNotFoundError } from "@/lib/documents/parties";
import {
  compareConsignee,
  parseConsigneeDivergences,
  snapshotFromExtractedParty,
  type ConsigneeDivergence,
} from "@/lib/documents/consignee-check";
import { getDefaultConsignee } from "@/lib/documents/consignee-settings";
import { overwriteLatestExtractionPayload } from "@/lib/documents/extractions";
import type { ImportExtractionPatch } from "@/lib/documents/import-edit-shared";
import {
  displayImportReference,
  etaBrToIsoDate,
  fallbackSavedReference,
  formatIsoDateBr,
  IMPORT_STATUS_LABELS,
  normalizeImportKey,
  normalizeImportSort,
  trackingStatusPriority,
  type ImportDetail,
  type ImportPartySummary,
  type ImportRow,
  type ImportSort,
  type ImportStatus,
} from "@/lib/documents/imports-shared";
import {
  buildPage,
  escapeLike,
  normalizePage,
  normalizePageSize,
  normalizeSearch,
  type ListOptions,
  type Page,
} from "@/lib/pagination";

export type {
  ImportDetail,
  ImportRow,
  ImportStatus,
} from "@/lib/documents/imports-shared";

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConflictError";
  }
}

/**
 * Erro interno de persistência da importação. Preserva o `code` do Postgres
 * (ex.: `23505` de violação de índice único) para que as camadas acima possam
 * reagir a corridas sem parsear a mensagem.
 */
class ImportPersistenceError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ImportPersistenceError";
    this.code = code;
  }
}

/** `23505` = unique_violation. Aceita tanto o erro interno quanto o erro cru do PostgREST. */
function isUniqueViolation(error: unknown): boolean {
  if (error instanceof ImportPersistenceError) return error.code === "23505";
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

const IMPORT_LIST_SELECT =
  "id, reference_number, status, supplier_name, invoice_number, bl_number, created_at, eta, consignee_divergences";

const IMPORT_SORT_ORDER: Record<
  ImportSort,
  { column: "created_at" | "reference_number" | "eta"; ascending: boolean }
> = {
  created_desc: { column: "created_at", ascending: false },
  created_asc: { column: "created_at", ascending: true },
  reference_asc: { column: "reference_number", ascending: true },
  reference_desc: { column: "reference_number", ascending: false },
  eta_asc: { column: "eta", ascending: true },
  eta_desc: { column: "eta", ascending: false },
};

const IMPORT_DETAIL_SELECT = `${IMPORT_LIST_SELECT}, updated_at, consignee_id, notify_id`;

const REFERENCE_MAX_LENGTH = 120;

function parseReferenceNumber(value: string): string | null {
  const reference = normalizeImportKey(value);
  if (!reference) return null;
  if (reference.length > REFERENCE_MAX_LENGTH) {
    throw new ImportValidationError(
      `Referência deve ter no máximo ${REFERENCE_MAX_LENGTH} caracteres`,
    );
  }
  return reference;
}

type ImportLookupRow = {
  id: string;
  reference_number: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  bl_number: string | null;
};

async function findImportByColumn(
  tenantId: string,
  column: "bl_number" | "invoice_number" | "reference_number",
  value: string,
): Promise<ImportLookupRow | null> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("imports")
    .select("id, reference_number, supplier_name, invoice_number, bl_number")
    .eq("tenant_id", tenantId)
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar importação");
  }

  return data;
}

async function findImportByKeys(params: {
  tenantId: string;
  invoiceNumber: string | null;
  blNumber: string | null;
}): Promise<ImportLookupRow | null> {
  if (params.blNumber) {
    const byBl = await findImportByColumn(
      params.tenantId,
      "bl_number",
      params.blNumber,
    );
    if (byBl) return byBl;
  }
  if (params.invoiceNumber) {
    const byInvoice = await findImportByColumn(
      params.tenantId,
      "invoice_number",
      params.invoiceNumber,
    );
    if (byInvoice) return byInvoice;
  }
  return null;
}

export type ImportListOptions = ListOptions & {
  status?: string | null;
  sort?: ImportSort | null;
};

function normalizeImportStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Object.prototype.hasOwnProperty.call(IMPORT_STATUS_LABELS, value)
    ? value
    : null;
}

/**
 * Data de embarque (DD/MM/AAAA) da extração de BL mais recente de cada
 * importação. Falha aqui não derruba a listagem: registra o erro e devolve o
 * mapa vazio.
 */
async function loadBlOnboardDates(
  supabase: Awaited<ReturnType<typeof getReadClient>>,
  tenantId: string,
  importIds: string[],
): Promise<Map<string, string>> {
  const onboardDates = new Map<string, string>();
  if (importIds.length === 0) return onboardDates;

  try {
    const { data: documents, error: documentsError } = await supabase
      .from("documents")
      .select("id, import_id")
      .eq("tenant_id", tenantId)
      .eq("doc_type", "bill_of_lading")
      .in("import_id", importIds);

    if (documentsError) {
      throw new Error(documentsError.message || "Falha ao listar BLs");
    }

    const importByDocument = new Map(
      (documents ?? []).map((document) => [document.id, document.import_id]),
    );
    if (importByDocument.size === 0) return onboardDates;

    const { data: extractions, error: extractionsError } = await supabase
      .from("extraction_results")
      .select("document_id, payload")
      .in("document_id", [...importByDocument.keys()])
      .order("created_at", { ascending: false });

    if (extractionsError) {
      throw new Error(
        extractionsError.message || "Falha ao buscar extrações de BL",
      );
    }

    // Ordenado por created_at desc: o primeiro valor não vazio por import é o mais recente.
    for (const extraction of extractions ?? []) {
      const importId = importByDocument.get(extraction.document_id);
      if (!importId || onboardDates.has(importId)) continue;
      const payload = extraction.payload as { onboardDate?: unknown } | null;
      const onboardDate =
        typeof payload?.onboardDate === "string"
          ? payload.onboardDate.trim()
          : "";
      if (onboardDate) onboardDates.set(importId, onboardDate);
    }
  } catch (error) {
    console.error("[importacoes] falha ao carregar data de embarque:", error);
  }

  return onboardDates;
}

/**
 * Status de rastreio mais relevante por importação (chegada > em trânsito >
 * demais; empate favorece o alvo de BL). Falha aqui não derruba a listagem:
 * registra o erro e devolve o mapa vazio.
 */
async function loadTrackingStatuses(
  supabase: Awaited<ReturnType<typeof getReadClient>>,
  tenantId: string,
  importIds: string[],
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  if (importIds.length === 0) return statuses;

  try {
    const { data, error } = await supabase
      .from("tracking_shipments")
      .select("import_id, query_type, status")
      .eq("tenant_id", tenantId)
      .in("import_id", importIds);

    if (error) {
      throw new Error(error.message || "Falha ao buscar status do rastreio");
    }

    const rows = (data ?? [])
      .map((row) => ({
        importId: row.import_id,
        isBl: row.query_type === "bl",
        status: typeof row.status === "string" ? row.status.trim() : "",
      }))
      .filter((row) => row.status !== "")
      .sort(
        (a, b) =>
          trackingStatusPriority(b.status) - trackingStatusPriority(a.status) ||
          Number(b.isBl) - Number(a.isBl),
      );
    for (const row of rows) {
      if (!statuses.has(row.importId)) statuses.set(row.importId, row.status);
    }
  } catch (error) {
    console.error("[importacoes] falha ao carregar status do rastreio:", error);
  }

  return statuses;
}

/**
 * Lista imports do tenant com o client do usuário (RLS aplicado).
 * O filtro por tenant_id permanece como defesa em profundidade.
 */
export async function listTenantImports(
  tenantId: string,
  options: ImportListOptions = {},
): Promise<Page<ImportRow>> {
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const search = normalizeSearch(options.search);
  const status = normalizeImportStatus(options.status);
  const order = IMPORT_SORT_ORDER[normalizeImportSort(options.sort)];
  const from = (page - 1) * pageSize;

  const supabase = await getReadClient();
  let query = supabase
    .from("imports")
    .select(IMPORT_LIST_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (search) {
    query = query.ilike("reference_number", `%${escapeLike(search)}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []).map((row) => ({
    ...row,
    consignee_divergences: parseConsigneeDivergences(
      row.consignee_divergences,
    ),
  }));
  const importIds = rows.map((row) => row.id);
  const [onboardDates, trackingStatuses] = await Promise.all([
    loadBlOnboardDates(supabase, tenantId, importIds),
    loadTrackingStatuses(supabase, tenantId, importIds),
  ]);

  return buildPage(
    rows.map((row) => ({
      ...row,
      eta: formatIsoDateBr(row.eta),
      onboardDate: onboardDates.get(row.id) ?? null,
      trackingStatus: trackingStatuses.get(row.id) ?? null,
    })),
    count ?? 0,
    page,
    pageSize,
  );
}

/**
 * Remove a importação em uma transação no banco (`delete_import`): documentos e
 * extrações caem por FK em cascata e os `storage_path` são devolvidos para a
 * limpeza do Storage. Se a remoção do arquivo falhar, a importação já foi
 * removida e o arquivo órfão fica registrado no log.
 */
export async function deleteImportRecord(
  tenantId: string,
  importId: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("delete_import", {
    p_tenant_id: tenantId,
    p_import_id: importId,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new ImportNotFoundError();
    }
    throw new Error(error.message || "Falha ao remover importação");
  }

  const storagePaths = [...new Set((data ?? []).filter(Boolean))];

  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage
      .from("import-documents")
      .remove(storagePaths);
    if (storageError) {
      console.error(
        "[imports delete] Falha ao remover arquivos do Storage",
        storageError,
      );
    }
  }
}

async function createImportRecord(params: {
  tenantId: string;
  userId: string;
  invoiceNumber?: string | null;
  blNumber?: string | null;
  supplierName?: string | null;
}): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("imports")
    .insert({
      tenant_id: params.tenantId,
      reference_number: null,
      status: "processing",
      created_by: params.userId,
      invoice_number: params.invoiceNumber ?? null,
      bl_number: params.blNumber ?? null,
      supplier_name: params.supplierName?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new ImportPersistenceError(
      error?.message || "Falha ao criar importação",
      error?.code,
    );
  }
  return data.id;
}

const KEY_CONFLICT_INDEXES: Record<string, "bl_number" | "invoice_number"> = {
  imports_tenant_bl_number_key: "bl_number",
  imports_tenant_invoice_number_key: "invoice_number",
};

/** Descobre qual chave de consolidação colidiu a partir da mensagem do Postgres. */
function conflictingKeyColumn(
  message: string | undefined,
): "bl_number" | "invoice_number" | null {
  if (!message) return null;
  for (const [indexName, column] of Object.entries(KEY_CONFLICT_INDEXES)) {
    if (message.includes(indexName)) return column;
  }
  return null;
}

/**
 * Grava o patch de chaves tolerando disputa pelo índice único.
 *
 * Em `23505`, descarta a coluna conflitante (a chave já pertence a outra
 * importação) e tenta de novo uma única vez. Se ainda falhar — ou se o índice
 * não for reconhecido — apenas registra `console.warn`: uma chave disputada não
 * pode interromper a análise.
 */
type ImportKeysPatch = {
  invoice_number?: string | null;
  bl_number?: string | null;
  supplier_name?: string | null;
};

async function updateImportKeys(params: {
  tenantId: string;
  importId: string;
  patch: ImportKeysPatch;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch: ImportKeysPatch = { ...params.patch };
  let conflict: string | null = null;

  while (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from("imports")
      .update(patch)
      .eq("id", params.importId)
      .eq("tenant_id", params.tenantId);

    if (!error) return;
    if (error.code !== "23505") {
      throw new Error(
        error.message || "Falha ao atualizar chaves da importação",
      );
    }

    // A segunda colisão encerra a tentativa: o retry é único.
    const column: "bl_number" | "invoice_number" | null =
      conflict === null ? conflictingKeyColumn(error.message) : null;
    if (!column) {
      console.warn(
        "[imports] chave de consolidação já pertence a outra importação",
        {
          importId: params.importId,
          tenantId: params.tenantId,
          conflict,
          error: error.message,
        },
      );
      return;
    }
    conflict = column;
    delete patch[column];
  }

  console.warn(
    "[imports] chave de consolidação já pertence a outra importação",
    {
      importId: params.importId,
      tenantId: params.tenantId,
      conflict,
    },
  );
}

/**
 * Preenche as chaves de consolidação ainda vazias da importação.
 *
 * Regra 1:1 por tenant — `bl_number` e `invoice_number` identificam no máximo
 * uma importação cada; quando o documento traz as duas, o BL precede a Invoice
 * na escolha da importação. A chave que já pertence a outra importação não é
 * copiada (fica nula) e o processamento continua.
 */
export async function fillImportKeysIfEmpty(params: {
  tenantId: string;
  importId: string;
  invoiceNumber?: string | null;
  blNumber?: string | null;
  supplierName?: string | null;
}): Promise<void> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("imports")
    .select("invoice_number, bl_number, supplier_name")
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar importação");
  }
  if (!data) return;

  const patch: ImportKeysPatch = {};
  if (!data.invoice_number && params.invoiceNumber) {
    patch.invoice_number = params.invoiceNumber;
  }
  if (!data.bl_number && params.blNumber) {
    patch.bl_number = params.blNumber;
  }
  if (!data.supplier_name && params.supplierName) {
    patch.supplier_name = params.supplierName;
  }

  if (Object.keys(patch).length === 0) return;

  await updateImportKeys({
    tenantId: params.tenantId,
    importId: params.importId,
    patch,
  });
}

/**
 * Grava a referência extraída do arquivo apenas quando ainda não existe uma
 * (nunca sobrescreve o que o usuário digitou). Violação de unicidade
 * (`tenant_id, reference_number`) é ignorada: outra importação já usa o código.
 */
export async function fillImportReferenceIfEmpty(params: {
  tenantId: string;
  importId: string;
  referenceNumber: string | null | undefined;
}): Promise<boolean> {
  const referenceNumber = (params.referenceNumber ?? "").trim();
  if (!referenceNumber) return false;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({ reference_number: referenceNumber.slice(0, 120) })
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId)
    .is("reference_number", null);

  if (error) {
    if (error.code === "23505") return false;
    throw new Error(
      error.message || "Falha ao salvar a referência da importação",
    );
  }
  return true;
}

export async function clearAutoReferenceIfNeeded(params: {
  tenantId: string;
  importId: string;
}): Promise<void> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("imports")
    .select("reference_number, invoice_number, bl_number")
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message || "Falha ao buscar referência da importação",
    );
  }
  if (!data?.reference_number) return;
  if (displayImportReference(data) !== "") return;

  const admin = createSupabaseAdminClient();
  const { error: updateError } = await admin
    .from("imports")
    .update({ reference_number: null })
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId);

  if (updateError) {
    throw new Error(
      updateError.message || "Falha ao limpar referência automática",
    );
  }
}

/** Reaproveita uma importação existente: completa chaves, limpa referência automática e marca `processing`. */
async function reuseImport(
  params: {
    tenantId: string;
    invoiceNumber: string | null;
    blNumber: string | null;
    supplierName: string | null;
  },
  existing: ImportLookupRow,
): Promise<void> {
  await fillImportKeysIfEmpty({
    tenantId: params.tenantId,
    importId: existing.id,
    invoiceNumber: params.invoiceNumber,
    blNumber: params.blNumber,
    supplierName: params.supplierName,
  });
  await clearAutoReferenceIfNeeded({
    tenantId: params.tenantId,
    importId: existing.id,
  });
  await updateImportStatus({
    tenantId: params.tenantId,
    importId: existing.id,
    status: "processing",
  });
}

/**
 * Localiza a importação das chaves informadas ou cria uma nova.
 *
 * Regra 1:1 por tenant — BL precede Invoice na busca; a chave que já pertence a
 * outra importação não é copiada. Se outra request criar a importação entre a
 * busca e o insert (corrida), o índice único devolve `23505`: buscamos de novo e
 * reutilizamos a importação vencedora.
 */
export async function findOrCreateImport(params: {
  tenantId: string;
  userId: string;
  invoiceNumber: string | null;
  blNumber: string | null;
  supplierName: string | null;
}): Promise<{ importId: string; created: boolean }> {
  const existing = await findImportByKeys(params);
  if (existing) {
    await reuseImport(params, existing);
    return { importId: existing.id, created: false };
  }

  try {
    const importId = await createImportRecord(params);
    return { importId, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Perdemos a corrida: outra request já gravou (ao menos) uma das chaves.
    const winner = await findImportByKeys(params);
    if (!winner) throw error;

    await reuseImport(params, winner);
    return { importId: winner.id, created: false };
  }
}

export async function updateImportStatus(params: {
  tenantId: string;
  importId: string;
  status: ImportStatus;
  extra?: { supplierName?: string | null };
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({
      status: params.status,
      ...(params.extra?.supplierName != null
        ? { supplier_name: params.extra.supplierName }
        : {}),
    })
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId);

  if (error) {
    throw new Error(error.message || "Falha ao atualizar importação");
  }
}

async function getPartySummary(
  tenantId: string,
  partyId: string | null,
): Promise<ImportPartySummary | null> {
  if (!partyId) return null;
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("parties")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", partyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao buscar parte da importação");
  }
  if (!data) return null;
  return { id: data.id, name: data.name };
}

export async function getImportDetail(
  tenantId: string,
  id: string,
): Promise<ImportDetail> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("imports")
    .select(IMPORT_DETAIL_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao carregar importação");
  }
  if (!data) {
    throw new ImportNotFoundError();
  }

  const { data: documents, error: docsError } = await supabase
    .from("documents")
    .select("id, doc_type, original_filename, status, version, created_at")
    .eq("import_id", id)
    .order("created_at", { ascending: true });

  if (docsError) {
    throw new Error(docsError.message || "Falha ao listar documentos");
  }

  const invoiceDocIds = (documents ?? [])
    .filter((row) => row.doc_type === "invoice")
    .map((row) => row.id);
  const blDocIds = (documents ?? [])
    .filter((row) => row.doc_type === "bill_of_lading")
    .map((row) => row.id);

  async function latestExtractionPayload<T>(
    documentIds: string[],
  ): Promise<T | null> {
    if (documentIds.length === 0) return null;
    const { data: extraction, error: extractionError } = await supabase
      .from("extraction_results")
      .select("payload")
      .in("document_id", documentIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (extractionError) {
      throw new Error(extractionError.message || "Falha ao buscar extração");
    }
    return (extraction?.payload as T | undefined) ?? null;
  }

  const [invoice, bl, defaultConsignee] = await Promise.all([
    latestExtractionPayload<InvoiceExtraction>(invoiceDocIds),
    latestExtractionPayload<BlExtraction>(blDocIds),
    getDefaultConsignee(tenantId),
  ]);

  const documentConsignee = snapshotFromExtractedParty(
    invoice?.importer ??
      bl?.consigneeDetails ??
      (bl?.consignee
        ? { name: bl.consignee, cnpj: null, address: null }
        : null),
  );

  const [consignee, notify] = await Promise.all([
    getPartySummary(tenantId, data.consignee_id ?? null),
    getPartySummary(tenantId, data.notify_id ?? null),
  ]);

  return {
    id: data.id,
    reference_number: data.reference_number ?? null,
    status: data.status,
    supplier_name: data.supplier_name ?? null,
    invoice_number: data.invoice_number ?? null,
    bl_number: data.bl_number ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
    consignee,
    notify,
    documents: (documents ?? []).map((document) => ({
      ...document,
      doc_type: document.doc_type as DocumentType,
    })),
    invoice,
    bl,
    defaultConsignee,
    documentConsignee,
    consigneeDivergences: compareConsignee(documentConsignee, defaultConsignee),
  };
}

/**
 * Vincula a importação ao consignee padrão do tenant (regra: um consignee por
 * tenant, sempre ele — independentemente do documento).
 */
export async function updateImportConsignee(params: {
  tenantId: string;
  importId: string;
  partyId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({ consignee_id: params.partyId })
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId);

  if (error) {
    throw new Error(
      error.message || "Falha ao atualizar consignee da importação",
    );
  }
}

/**
 * Grava a verificação do documento contra o consignee padrão.
 * `null` = não verificado (sem padrão configurado); `[]` = verificado sem
 * divergências.
 */
export async function updateImportConsigneeDivergences(params: {
  tenantId: string;
  importId: string;
  divergences: ConsigneeDivergence[] | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({ consignee_divergences: params.divergences ?? null })
    .eq("id", params.importId)
    .eq("tenant_id", params.tenantId);

  if (error) {
    throw new Error(
      error.message || "Falha ao atualizar divergências do consignee",
    );
  }
}

export async function updateImportRecord(
  tenantId: string,
  id: string,
  params: { referenceNumber: string; supplierName?: string | null },
): Promise<ImportDetail> {
  const current = await getImportDetail(tenantId, id);

  const typedReference = parseReferenceNumber(params.referenceNumber);
  const referenceNumber =
    typedReference ??
    fallbackSavedReference({
      blNumber: current.bl_number,
      invoiceNumber: current.invoice_number,
    });
  const supplierName =
    params.supplierName === undefined
      ? undefined
      : params.supplierName?.trim() || null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("imports")
    .update({
      reference_number: referenceNumber,
      ...(supplierName !== undefined ? { supplier_name: supplierName } : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error?.code === "23505" && referenceNumber) {
    const existing = await findImportByColumn(
      tenantId,
      "reference_number",
      referenceNumber,
    );
    if (!existing || existing.id === id) {
      throw new ImportConflictError(
        "Já existe uma importação com esta referência",
      );
    }
    return mergeImportInto(tenantId, id, existing.id, {
      supplierName,
    });
  }
  if (error) {
    throw new Error(error.message || "Falha ao atualizar importação");
  }

  return getImportDetail(tenantId, id);
}

/**
 * Espelha o ETA da extração de BL mais recente em `imports.eta` (usado na
 * ordenação da listagem). Vazio ou inválido grava `null`. Roda sem sessão
 * (pipeline/worker/rastreio), então usa o client admin; falha é logada e não
 * interrompe o fluxo que chamou.
 */
export async function syncImportEta(params: {
  tenantId: string;
  importId: string;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: documents, error: documentsError } = await admin
      .from("documents")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("import_id", params.importId)
      .eq("doc_type", "bill_of_lading");

    if (documentsError) {
      throw new Error(
        documentsError.message || "Falha ao listar BLs da importação",
      );
    }

    const documentIds = (documents ?? []).map((row) => row.id);
    let eta: string | null = null;
    if (documentIds.length > 0) {
      const { data: extraction, error: extractionError } = await admin
        .from("extraction_results")
        .select("payload")
        .eq("tenant_id", params.tenantId)
        .in("document_id", documentIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (extractionError) {
        throw new Error(
          extractionError.message || "Falha ao buscar extração do BL",
        );
      }
      const payload = extraction?.payload as { eta?: unknown } | null;
      eta = etaBrToIsoDate(
        typeof payload?.eta === "string" ? payload.eta : null,
      );
    }

    const { error } = await admin
      .from("imports")
      .update({ eta })
      .eq("id", params.importId)
      .eq("tenant_id", params.tenantId);

    if (error) {
      throw new Error(error.message || "Falha ao salvar ETA da importação");
    }
  } catch (error) {
    console.error("[importacoes] falha ao sincronizar ETA:", error);
  }
}

/**
 * Aplica correções manuais do usuário sobre o que a IA extraiu: números da
 * Invoice/BL (colunas de `imports`) e campos do BL/produtos (payload da
 * extração mais recente de cada documento).
 */
export async function updateImportExtractionData(
  tenantId: string,
  id: string,
  patch: ImportExtractionPatch,
): Promise<ImportDetail> {
  const current = await getImportDetail(tenantId, id);

  const invoiceDocIds = current.documents
    .filter((document) => document.doc_type === "invoice")
    .map((document) => document.id);
  const blDocIds = current.documents
    .filter((document) => document.doc_type === "bill_of_lading")
    .map((document) => document.id);

  const blPatchKeys = patch.bl ? Object.keys(patch.bl) : [];
  const hasBlPatch = blPatchKeys.length > 0;
  const hasProducts = patch.products !== undefined;

  if (hasBlPatch && (!current.bl || blDocIds.length === 0)) {
    throw new ImportValidationError("Nenhum dado de BL extraído para corrigir");
  }
  if (hasProducts && (!current.invoice || invoiceDocIds.length === 0)) {
    throw new ImportValidationError(
      "Nenhum dado de Invoice extraído para corrigir",
    );
  }

  const invoiceNumber =
    patch.invoiceNumber === undefined
      ? undefined
      : normalizeImportKey(patch.invoiceNumber);
  const blNumber =
    patch.blNumber === undefined
      ? undefined
      : normalizeImportKey(patch.blNumber);

  if (hasBlPatch) {
    const payload = {
      ...current.bl,
      ...patch.bl,
      ...(blNumber !== undefined ? { number: blNumber } : {}),
    };
    const saved = await overwriteLatestExtractionPayload({
      tenantId,
      documentIds: blDocIds,
      payload,
    });
    if (!saved) {
      throw new ImportValidationError(
        "Nenhum dado de BL extraído para corrigir",
      );
    }
    await syncImportEta({ tenantId, importId: id });
  }

  if (hasProducts || invoiceNumber !== undefined || blNumber !== undefined) {
    if (current.invoice && invoiceDocIds.length > 0) {
      const payload = {
        ...current.invoice,
        ...(hasProducts ? { products: patch.products } : {}),
        ...(invoiceNumber !== undefined ? { number: invoiceNumber } : {}),
        ...(blNumber !== undefined ? { blNumber } : {}),
      };
      await overwriteLatestExtractionPayload({
        tenantId,
        documentIds: invoiceDocIds,
        payload,
      });
    }
  }

  if (invoiceNumber !== undefined || blNumber !== undefined) {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("imports")
      .update({
        ...(invoiceNumber !== undefined
          ? { invoice_number: invoiceNumber }
          : {}),
        ...(blNumber !== undefined ? { bl_number: blNumber } : {}),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error?.code === "23505") {
      throw new ImportConflictError(
        "Já existe outra importação com este número de Invoice ou BL",
      );
    }
    if (error) {
      throw new Error(error.message || "Falha ao atualizar importação");
    }
  }

  return getImportDetail(tenantId, id);
}

/**
 * Consolida a importação de origem na de destino em uma transação no banco
 * (`merge_imports`): documentos, extrações, resultados, matches, ai_logs,
 * chaves e partes mudam juntos; falha em qualquer passo desfaz tudo.
 */
async function mergeImportInto(
  tenantId: string,
  sourceId: string,
  targetId: string,
  extras?: { supplierName?: string | null },
): Promise<ImportDetail> {
  if (sourceId === targetId) {
    return getImportDetail(tenantId, targetId);
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("merge_imports", {
    p_tenant_id: tenantId,
    p_source_id: sourceId,
    p_target_id: targetId,
    p_supplier_name: extras?.supplierName ?? undefined,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new ImportNotFoundError();
    }
    throw new Error(error.message || "Falha ao consolidar importações");
  }

  return getImportDetail(tenantId, targetId);
}
