import "server-only";

import { displayImportReference } from "@/lib/documents/imports-shared";
import { getReadClient } from "@/lib/supabase/read-client";
import { carrierLabelFor } from "@/lib/tracking/carriers";
import { normalizeBlNumber } from "@/lib/tracking/validate";
import {
  trackingNextCheckLabel,
  trackingStatusLabel,
  type TrackingQueryType,
  type TrackingStatus,
  type TrackingVesselMismatch,
} from "@/lib/tracking/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Eventos buscados para a tabela de marcos (a tela não pagina). */
const MAX_EVENT_ROWS = 200;

const SHIPMENT_SELECT =
  "id, import_id, carrier_code, query_type, query_value, container_number, status, vessel, voyage, eta, eta_original, ata, fetched_at, next_check_at, error_code, error_message, created_at, raw";

const SIBLING_SELECT =
  "id, query_type, query_value, container_number, status, eta, ata, created_at";

const EVENT_SELECT =
  "id, event_at, status, location, description, vessel, voyage, container_number, source, created_at";

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const BR_DAY_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Eventos que indicam transbordo (status canônico ou descrição). */
const TRANSSHIPMENT_RE = /transship|transbordo|trans-?shipment/i;

type BadgeVariant = ReturnType<typeof trackingStatusLabel>["variant"];

type ShipmentDetailRow = {
  id: string;
  import_id: string;
  carrier_code: string;
  query_type: string;
  query_value: string;
  container_number: string | null;
  status: string;
  vessel: string | null;
  voyage: string | null;
  eta: string | null;
  eta_original: string | null;
  ata: string | null;
  fetched_at: string | null;
  next_check_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  /** Snapshot da última consulta (`vesselMismatch` incluído). */
  raw: unknown;
};

type SiblingRow = {
  id: string;
  query_type: string;
  query_value: string;
  container_number: string | null;
  status: string;
  eta: string | null;
  ata: string | null;
  created_at: string;
};

type EventDetailRow = {
  id: string;
  event_at: string;
  status: string;
  location: string | null;
  description: string | null;
  vessel: string | null;
  voyage: string | null;
  container_number: string | null;
  source: string;
  created_at: string;
};

type ImportRow = {
  id: string;
  reference_number: string | null;
  invoice_number: string | null;
  bl_number: string | null;
};

export type TrackingRoutePoint = {
  /** Cidade e país do porto ("Itapoá, Brasil"). */
  label: string;
  date: string | null;
};

type TrackingDetailShipment = {
  id: string;
  importId: string;
  carrierCode: string;
  /** Rótulo do armador (`CARRIERS`). */
  carrier: string;
  queryType: TrackingQueryType;
  queryValue: string;
  /** Tag do cabeçalho: `BL`, `BL master`, `CNTR` ou `BOOKING`. */
  queryTag: string;
  /** O BL consultado é o master da consolidação, não o BL do documento. */
  isMasterBl: boolean;
  containerNumber: string | null;
  status: TrackingStatus;
  statusLabel: string;
  statusVariant: BadgeVariant;
  /** Navio do shipment; cai para o `vessel` do BL quando o armador não informa. */
  vessel: string | null;
  /** Viagem do shipment; cai para o `voyage` do BL quando o armador não informa. */
  voyage: string | null;
  /** Navio do portal difere do BL (possível rollover/transbordo). */
  vesselMismatch: TrackingVesselMismatch | null;
  eta: string | null;
  /** Primeiro ETA informado pelo armador (base do atraso). */
  etaOriginal: string | null;
  /** Chegada real (evento de chegada/descarga). */
  ata: string | null;
  fetchedAt: string | null;
  nextCheckAt: string | null;
  /** Data agendada, "Concluído" (status final) ou "Aguardando consulta". */
  nextCheckLabel: string;
  errorCode: string | null;
  errorMessage: string | null;
};

type TrackingDetailImport = {
  id: string;
  /** `displayImportReference` com fallback para o `bl_number`. */
  reference: string | null;
  referenceNumber: string | null;
  invoiceNumber: string | null;
  blNumber: string | null;
};

type TrackingDetailBillOfLading = {
  number: string | null;
  originCity: string | null;
  originCountry: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  onboardDate: string | null;
  vessel: string | null;
  voyage: string | null;
  containers: string[];
};

type TrackingDetailRoute = {
  origin: TrackingRoutePoint | null;
  destination: TrackingRoutePoint | null;
  /** Data de embarque extraída do BL (DD/MM/AAAA). */
  onboardDate: string | null;
  /** Sem transbordo registrado nos eventos. */
  direct: boolean;
};

type TrackingShipmentSibling = {
  id: string;
  queryType: TrackingQueryType;
  queryValue: string;
  queryTag: string;
  /** O BL consultado é o master da consolidação, não o BL do documento. */
  isMasterBl: boolean;
  containerNumber: string | null;
  status: TrackingStatus;
  statusLabel: string;
  statusVariant: BadgeVariant;
  eta: string | null;
  ata: string | null;
  isCurrent: boolean;
};

type TrackingDetailEvent = {
  id: string;
  /** Data/hora ISO do evento (`event_at`), base da coluna DATE. */
  dateIso: string;
  status: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  location: string | null;
  description: string | null;
  vessel: string | null;
  voyage: string | null;
  containerNumber: string | null;
  source: "scrape" | "manual";
};

type TrackingDetailDerived = {
  /** Primeiro evento (ou embarque) até a chegada real/prevista. */
  transitDays: number | null;
  /** `(ata ?? eta) - eta_original`; positivo = atraso. */
  delayDays: number | null;
  /** "No prazo" | "Atrasado +X dias" | "Adiantado −X dias". */
  delayLabel: string | null;
  delayVariant: BadgeVariant;
  /** Eventos de transbordo registrados. */
  transhipments: number;
  /** Containers do shipment/BL, sem repetição. */
  containers: string[];
};

export type TrackingShipmentDetail = {
  shipment: TrackingDetailShipment;
  import: TrackingDetailImport | null;
  billOfLading: TrackingDetailBillOfLading | null;
  route: TrackingDetailRoute;
  siblings: TrackingShipmentSibling[];
  /** Mais recente primeiro (a tabela de marcos acompanha a timeline). */
  events: TrackingDetailEvent[];
  derived: TrackingDetailDerived;
};

/** Shipment inexistente ou de outro tenant (RLS/filtro de `tenant_id`). */
export class TrackingShipmentNotFoundError extends Error {
  constructor() {
    super("Rastreio não encontrado");
    this.name = "TrackingShipmentNotFoundError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readText(item))
    .filter((item): item is string => item !== null);
}

/**
 * Divergência de navio persistida no snapshot (`raw.snapshot.vesselMismatch`).
 * Snapshots antigos (ou de providers sem o metadado) devolvem `null`.
 */
function readVesselMismatch(raw: unknown): TrackingVesselMismatch | null {
  if (!isRecord(raw) || !isRecord(raw.snapshot)) return null;
  const mismatch = raw.snapshot.vesselMismatch;
  if (!isRecord(mismatch)) return null;
  const expected = readText(mismatch.expected);
  const found = readText(mismatch.found);
  return expected && found ? { expected, found } : null;
}

/** Timestamp (UTC) de uma data ISO `YYYY-MM-DD` ou pt-BR `DD/MM/AAAA`. */
function dayTimestamp(value: string | null | undefined): number | null {
  const raw = value?.trim();
  if (!raw) return null;

  const iso = ISO_DAY_RE.exec(raw);
  if (iso) {
    return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const br = BR_DAY_RE.exec(raw);
  if (br) {
    return Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Dias inteiros entre duas datas (positivo quando `later` é depois). */
function daysBetween(
  later: string | null | undefined,
  earlier: string | null | undefined,
): number | null {
  const laterTime = dayTimestamp(later);
  const earlierTime = dayTimestamp(earlier);
  if (laterTime === null || earlierTime === null) return null;
  return Math.round((laterTime - earlierTime) / DAY_MS);
}

/** Tempo de trânsito nunca é negativo: dado inconsistente vira "—". */
function transitDaysBetween(
  later: string | null | undefined,
  earlier: string | null | undefined,
): number | null {
  const days = daysBetween(later, earlier);
  return days !== null && days >= 0 ? days : null;
}

function delayLabelFor(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "No prazo";
  const absolute = Math.abs(days);
  const unit = absolute === 1 ? "dia" : "dias";
  return days > 0
    ? `Atrasado +${absolute} ${unit}`
    : `Adiantado −${absolute} ${unit}`;
}

function delayVariantFor(days: number | null): BadgeVariant {
  if (days === null) return "outline";
  if (days > 0) return "destructive";
  if (days < 0) return "success";
  return "secondary";
}

function queryTagFor(queryType: TrackingQueryType, isMasterBl = false): string {
  switch (queryType) {
    case "bl":
      return isMasterBl ? "BL master" : "BL";
    case "container":
      return "CNTR";
    default:
      return "BOOKING";
  }
}

/**
 * O shipment de BL representa o **master** da consolidação quando o número
 * consultado difere do `imports.bl_number` (BL do documento, emitido pelo
 * agente de carga). Sem `bl_number` na importação não há como comparar.
 */
function isMasterBlShipment(params: {
  queryType: string;
  queryValue: string;
  blNumber: string | null;
}): boolean {
  if (params.queryType !== "bl") return false;
  const importBl = normalizeBlNumber(params.blNumber);
  if (!importBl) return false;
  return normalizeBlNumber(params.queryValue) !== importBl;
}

function isTranshipmentEvent(event: {
  status: string;
  description: string | null;
}): boolean {
  if (event.status === "transshipment") return true;
  return TRANSSHIPMENT_RE.test(event.description ?? "");
}

function mapBillOfLading(
  payload: Record<string, unknown> | null,
): TrackingDetailBillOfLading | null {
  if (!payload) return null;
  return {
    number: readText(payload.number),
    originCity: readText(payload.polCity),
    originCountry: readText(payload.polCountry),
    destinationCity: readText(payload.podCity),
    destinationCountry: readText(payload.podCountry),
    onboardDate: readText(payload.onboardDate),
    vessel: readText(payload.vessel),
    voyage: readText(payload.voyage),
    containers: readTextList(payload.containerNumbers),
  };
}

function portLabel(city: string | null, country: string | null): string {
  return [city, country].filter(Boolean).join(", ");
}

/** Container do shipment, do BL, dos irmãos e dos eventos (sem repetição). */
function collectContainers(params: {
  shipment: ShipmentDetailRow;
  billOfLading: TrackingDetailBillOfLading | null;
  siblings: SiblingRow[];
  events: EventDetailRow[];
}): string[] {
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = value?.trim().toUpperCase();
    if (normalized) seen.add(normalized);
  };

  add(params.shipment.container_number);
  for (const container of params.billOfLading?.containers ?? []) add(container);
  for (const sibling of params.siblings) {
    if (sibling.query_type === "container") add(sibling.query_value);
  }
  for (const event of params.events) add(event.container_number);

  return [...seen].sort((a, b) => a.localeCompare(b));
}

function firstEventAt(events: EventDetailRow[]): string | null {
  let earliest: { value: string; time: number } | null = null;
  for (const event of events) {
    const time = Date.parse(event.event_at);
    if (Number.isNaN(time)) continue;
    if (!earliest || time < earliest.time) {
      earliest = { value: event.event_at, time };
    }
  }
  return earliest?.value ?? null;
}

/**
 * Detalhe de um shipment para a tela `/rastreio/[shipmentId]`.
 *
 * Lê via `getReadClient` (RLS em requests normais, service role no worker) e
 * filtra `tenant_id` em todas as consultas: um shipment de outro tenant é
 * indistinguível de um inexistente (`TrackingShipmentNotFoundError` → 404).
 */
export async function getTrackingShipmentDetail(params: {
  tenantId: string;
  shipmentId: string;
}): Promise<TrackingShipmentDetail> {
  const supabase = await getReadClient();

  const { data: shipmentData, error: shipmentError } = await supabase
    .from("tracking_shipments")
    .select(SHIPMENT_SELECT)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.shipmentId)
    .maybeSingle();

  if (shipmentError) {
    throw new Error(`Falha ao carregar rastreio: ${shipmentError.message}`);
  }
  if (!shipmentData) {
    throw new TrackingShipmentNotFoundError();
  }

  const shipment = shipmentData as unknown as ShipmentDetailRow;

  const [importQuery, siblingsQuery, eventsQuery, documentsQuery] =
    await Promise.all([
      supabase
        .from("imports")
        .select("id, reference_number, invoice_number, bl_number")
        .eq("tenant_id", params.tenantId)
        .eq("id", shipment.import_id)
        .maybeSingle(),
      supabase
        .from("tracking_shipments")
        .select(SIBLING_SELECT)
        .eq("tenant_id", params.tenantId)
        .eq("import_id", shipment.import_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("tracking_events")
        .select(EVENT_SELECT)
        .eq("tenant_id", params.tenantId)
        .eq("shipment_id", shipment.id)
        .order("event_at", { ascending: false })
        .limit(MAX_EVENT_ROWS),
      supabase
        .from("documents")
        .select("id")
        .eq("tenant_id", params.tenantId)
        .eq("import_id", shipment.import_id)
        .eq("doc_type", "bill_of_lading"),
    ]);

  if (importQuery.error) {
    throw new Error(
      `Falha ao carregar importação do rastreio: ${importQuery.error.message}`,
    );
  }
  if (siblingsQuery.error) {
    throw new Error(
      `Falha ao carregar shipments da importação: ${siblingsQuery.error.message}`,
    );
  }
  if (eventsQuery.error) {
    throw new Error(
      `Falha ao carregar eventos do rastreio: ${eventsQuery.error.message}`,
    );
  }
  if (documentsQuery.error) {
    throw new Error(
      `Falha ao carregar documentos do rastreio: ${documentsQuery.error.message}`,
    );
  }

  const importRow = (importQuery.data ?? null) as ImportRow | null;
  const siblings = (siblingsQuery.data ?? []) as unknown as SiblingRow[];
  const eventRows = (eventsQuery.data ?? []) as unknown as EventDetailRow[];
  const documentIds = (documentsQuery.data ?? []).map(
    (row) => (row as { id: string }).id,
  );

  let billOfLading: TrackingDetailBillOfLading | null = null;
  if (documentIds.length > 0) {
    const { data: extraction, error: extractionError } = await supabase
      .from("extraction_results")
      .select("payload")
      .eq("tenant_id", params.tenantId)
      .in("document_id", documentIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (extractionError) {
      throw new Error(
        `Falha ao carregar dados do BL: ${extractionError.message}`,
      );
    }

    const payload = (extraction as { payload?: unknown } | null)?.payload;
    billOfLading = mapBillOfLading(isRecord(payload) ? payload : null);
  }

  const status = trackingStatusLabel(shipment.status);
  const queryType = shipment.query_type as TrackingQueryType;
  const shipmentIsMasterBl = isMasterBlShipment({
    queryType: shipment.query_type,
    queryValue: shipment.query_value,
    blNumber: importRow?.bl_number ?? null,
  });

  const mappedSiblings: TrackingShipmentSibling[] = siblings.map((row) => {
    const siblingStatus = trackingStatusLabel(row.status);
    const siblingQueryType = row.query_type as TrackingQueryType;
    const siblingIsMasterBl = isMasterBlShipment({
      queryType: row.query_type,
      queryValue: row.query_value,
      blNumber: importRow?.bl_number ?? null,
    });
    return {
      id: row.id,
      queryType: siblingQueryType,
      queryValue: row.query_value,
      queryTag: queryTagFor(siblingQueryType, siblingIsMasterBl),
      isMasterBl: siblingIsMasterBl,
      containerNumber: row.container_number,
      status: row.status as TrackingStatus,
      statusLabel: siblingStatus.label,
      statusVariant: siblingStatus.variant,
      eta: row.eta,
      ata: row.ata,
      isCurrent: row.id === shipment.id,
    };
  });

  const mappedEvents: TrackingDetailEvent[] = eventRows.map((row) => {
    const eventStatus = trackingStatusLabel(row.status);
    return {
      id: row.id,
      dateIso: row.event_at,
      status: row.status,
      statusLabel: eventStatus.label,
      statusVariant: eventStatus.variant,
      location: row.location,
      description: row.description,
      vessel: row.vessel,
      voyage: row.voyage,
      containerNumber: row.container_number,
      source: row.source === "manual" ? "manual" : "scrape",
    };
  });

  const transhipments = eventRows.filter(isTranshipmentEvent).length;
  const containers = collectContainers({
    shipment,
    billOfLading,
    siblings,
    events: eventRows,
  });

  const arrival = shipment.ata ?? shipment.eta;
  const earliestEvent = firstEventAt(eventRows);
  const transitDays =
    transitDaysBetween(arrival, earliestEvent) ??
    transitDaysBetween(arrival, billOfLading?.onboardDate ?? null);
  const delayDays = daysBetween(arrival, shipment.eta_original);

  const originLabel = portLabel(
    billOfLading?.originCity ?? null,
    billOfLading?.originCountry ?? null,
  );
  const destinationLabel = portLabel(
    billOfLading?.destinationCity ?? null,
    billOfLading?.destinationCountry ?? null,
  );

  return {
    shipment: {
      id: shipment.id,
      importId: shipment.import_id,
      carrierCode: shipment.carrier_code,
      carrier: carrierLabelFor(shipment.carrier_code),
      queryType,
      queryValue: shipment.query_value,
      queryTag: queryTagFor(queryType, shipmentIsMasterBl),
      isMasterBl: shipmentIsMasterBl,
      containerNumber: shipment.container_number,
      status: shipment.status as TrackingStatus,
      statusLabel: status.label,
      statusVariant: status.variant,
      vessel: shipment.vessel ?? billOfLading?.vessel ?? null,
      voyage: shipment.voyage ?? billOfLading?.voyage ?? null,
      vesselMismatch: readVesselMismatch(shipment.raw),
      eta: shipment.eta,
      etaOriginal: shipment.eta_original,
      ata: shipment.ata,
      fetchedAt: shipment.fetched_at,
      nextCheckAt: shipment.next_check_at,
      nextCheckLabel: trackingNextCheckLabel(
        shipment.status,
        shipment.next_check_at,
      ),
      errorCode: shipment.error_code,
      errorMessage: shipment.error_message,
    },
    import: importRow
      ? {
          id: importRow.id,
          reference:
            displayImportReference(importRow) || importRow.bl_number || null,
          referenceNumber: importRow.reference_number,
          invoiceNumber: importRow.invoice_number,
          blNumber: importRow.bl_number,
        }
      : null,
    billOfLading,
    route: {
      origin: originLabel
        ? { label: originLabel, date: billOfLading?.onboardDate ?? earliestEvent }
        : null,
      destination: destinationLabel
        ? { label: destinationLabel, date: arrival }
        : null,
      onboardDate: billOfLading?.onboardDate ?? null,
      direct: transhipments === 0,
    },
    siblings: mappedSiblings,
    events: mappedEvents,
    derived: {
      transitDays,
      delayDays,
      delayLabel: delayLabelFor(delayDays),
      delayVariant: delayVariantFor(delayDays),
      transhipments,
      containers,
    },
  };
}
