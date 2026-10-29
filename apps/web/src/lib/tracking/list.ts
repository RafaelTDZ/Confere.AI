import "server-only";

import { displayImportReference } from "@/lib/documents/imports-shared";
import { getReadClient } from "@/lib/supabase/read-client";
import { carrierLabelFor } from "@/lib/tracking/carriers";
import {
  isInTransitTrackingStatus,
  isTerminalTrackingStatus,
  normalizeTrackingListFilter,
  trackingDaysUntilEta,
  trackingStatusLabel,
  type TrackingListFilter,
  type TrackingQueryType,
  type TrackingStatus,
} from "@/lib/tracking/shared";

/** Janela do filtro "chegando": ETA nos próximos 7 dias. */
const ARRIVING_WINDOW_DAYS = 7;

/** Linhas buscadas antes do filtro em memória (a tela não pagina). */
const MAX_LIST_ROWS = 500;

const DEFAULT_LIMIT = 300;

const TRACKING_LIST_SELECT =
  "id, import_id, carrier_code, query_type, query_value, status, eta, last_event_at, last_event_description, next_check_at, fetched_at";

type ImportReferenceRow = {
  id: string;
  reference_number: string | null;
  invoice_number: string | null;
  bl_number: string | null;
};

type ShipmentListRow = {
  id: string;
  import_id: string;
  carrier_code: string;
  query_type: string;
  query_value: string;
  status: string;
  eta: string | null;
  last_event_at: string | null;
  last_event_description: string | null;
  next_check_at: string | null;
  fetched_at: string | null;
};

export type TenantTrackingRow = {
  shipmentId: string;
  importId: string;
  /** Referência da importação; cai para o BL quando a referência é vazia. */
  importReference: string | null;
  blNumber: string | null;
  /** Rótulo do armador (`CARRIERS`). */
  carrier: string;
  queryType: TrackingQueryType;
  queryValue: string;
  status: TrackingStatus;
  statusLabel: string;
  statusVariant: ReturnType<typeof trackingStatusLabel>["variant"];
  eta: string | null;
  lastEventAt: string | null;
  lastEventDescription: string | null;
  nextCheckAt: string | null;
  fetchedAt: string | null;
};

export type TrackingListSummary = {
  total: number;
  inTransit: number;
  arriving: number;
  withoutEta: number;
  withoutCheck: number;
};

type TenantTrackingScope = {
  importId: string;
  /** `null` quando a importação não pertence ao tenant (ou não existe). */
  reference: string | null;
};

export type TenantTrackingList = {
  rows: TenantTrackingRow[];
  /** Contadores sobre o escopo (tenant ou importação), antes do filtro. */
  summary: TrackingListSummary;
  scope: TenantTrackingScope | null;
};

export type ListTenantTrackingParams = {
  tenantId: string;
  /** Restringe a uma importação (botão "Rastrear"). */
  importId?: string | null;
  filter?: TrackingListFilter | string | null;
  limit?: number;
  /** Injetável nos testes para o cálculo de "chegando". */
  now?: Date;
};

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIST_ROWS);
}

function importReferenceFor(
  row: ImportReferenceRow | undefined,
): string | null {
  if (!row) return null;
  return displayImportReference(row) || row.bl_number || null;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Mais recente primeiro. Sem evento ainda vai para o fim; empate cai no ETA
 * mais próximo e, por último, no número consultado (ordem estável na tela).
 */
function compareTrackingRows(
  a: TenantTrackingRow,
  b: TenantTrackingRow,
): number {
  const aLast = timestamp(a.lastEventAt);
  const bLast = timestamp(b.lastEventAt);
  if (aLast !== bLast) {
    if (aLast === null) return 1;
    if (bLast === null) return -1;
    return bLast - aLast;
  }

  if (a.eta !== b.eta) {
    if (a.eta === null) return 1;
    if (b.eta === null) return -1;
    return a.eta.localeCompare(b.eta);
  }

  return a.queryValue.localeCompare(b.queryValue);
}

type TrackingFilterInput = Pick<
  TenantTrackingRow,
  "status" | "eta" | "nextCheckAt" | "fetchedAt"
>;

/**
 * Regras dos filtros da tela. "Chegando" ignora status finais (um entregue com
 * ETA no passado não está chegando) e "sem consulta" também sinaliza shipment
 * não terminal sem próxima consulta agendada.
 */
export function matchesTrackingFilter(
  row: TrackingFilterInput,
  filter: TrackingListFilter,
  now: Date = new Date(),
): boolean {
  switch (filter) {
    case "transito":
      return isInTransitTrackingStatus(row.status);
    case "chegando": {
      if (isTerminalTrackingStatus(row.status)) return false;
      const days = trackingDaysUntilEta(row.eta, now);
      return days !== null && days <= ARRIVING_WINDOW_DAYS;
    }
    case "sem_eta":
      return !row.eta || row.eta.trim().length === 0;
    case "sem_consulta":
      return (
        !row.fetchedAt ||
        (!row.nextCheckAt && !isTerminalTrackingStatus(row.status))
      );
    default:
      return true;
  }
}

/** Contadores do topo da tela (sobre o escopo, sem aplicar o filtro ativo). */
export function summarizeTracking(
  rows: ReadonlyArray<TrackingFilterInput>,
  now: Date = new Date(),
): TrackingListSummary {
  const summary: TrackingListSummary = {
    total: 0,
    inTransit: 0,
    arriving: 0,
    withoutEta: 0,
    withoutCheck: 0,
  };

  for (const row of rows) {
    summary.total += 1;
    if (matchesTrackingFilter(row, "transito", now)) summary.inTransit += 1;
    if (matchesTrackingFilter(row, "chegando", now)) summary.arriving += 1;
    if (matchesTrackingFilter(row, "sem_eta", now)) summary.withoutEta += 1;
    if (matchesTrackingFilter(row, "sem_consulta", now)) summary.withoutCheck += 1;
  }

  return summary;
}

/**
 * Lista os shipments do tenant (leitura via RLS) com a importação resolvida em
 * uma única consulta `in` — sem N+1 por linha.
 */
export async function listTenantTracking(
  params: ListTenantTrackingParams,
): Promise<TenantTrackingList> {
  const now = params.now ?? new Date();
  const importId = params.importId?.trim() || null;
  const filter = normalizeTrackingListFilter(params.filter);
  const limit = normalizeLimit(params.limit);

  const supabase = await getReadClient();
  let query = supabase
    .from("tracking_shipments")
    .select(TRACKING_LIST_SELECT)
    .eq("tenant_id", params.tenantId);

  if (importId) query = query.eq("import_id", importId);

  const { data, error } = await query
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(MAX_LIST_ROWS);

  if (error) {
    throw new Error(`Falha ao carregar rastreios: ${error.message}`);
  }

  const shipments = (data ?? []) as ShipmentListRow[];
  const importIds = [...new Set(shipments.map((row) => row.import_id))];
  // A importação do chip pode não ter shipment nenhum: busca mesmo assim para
  // exibir a referência no cabeçalho.
  if (importId && !importIds.includes(importId)) importIds.push(importId);

  const importsById = new Map<string, ImportReferenceRow>();
  if (importIds.length > 0) {
    const { data: imports, error: importsError } = await supabase
      .from("imports")
      .select("id, reference_number, invoice_number, bl_number")
      .eq("tenant_id", params.tenantId)
      .in("id", importIds);

    if (importsError) {
      throw new Error(
        `Falha ao carregar importações do rastreio: ${importsError.message}`,
      );
    }

    for (const row of (imports ?? []) as ImportReferenceRow[]) {
      importsById.set(row.id, row);
    }
  }

  const mapped: TenantTrackingRow[] = shipments.map((row) => {
    const importRow = importsById.get(row.import_id);
    const status = trackingStatusLabel(row.status);
    return {
      shipmentId: row.id,
      importId: row.import_id,
      importReference: importReferenceFor(importRow),
      blNumber: importRow?.bl_number ?? null,
      carrier: carrierLabelFor(row.carrier_code),
      queryType: row.query_type as TrackingQueryType,
      queryValue: row.query_value,
      status: row.status as TrackingStatus,
      statusLabel: status.label,
      statusVariant: status.variant,
      eta: row.eta,
      lastEventAt: row.last_event_at,
      lastEventDescription: row.last_event_description,
      nextCheckAt: row.next_check_at,
      fetchedAt: row.fetched_at,
    };
  });

  mapped.sort(compareTrackingRows);

  const summary = summarizeTracking(mapped, now);
  const rows = mapped
    .filter((row) => matchesTrackingFilter(row, filter, now))
    .slice(0, limit);

  return {
    rows,
    summary,
    scope: importId
      ? {
          importId,
          reference: importReferenceFor(importsById.get(importId)),
        }
      : null,
  };
}
