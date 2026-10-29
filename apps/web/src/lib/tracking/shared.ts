/**
 * Tipos e rótulos do rastreio compartilhados entre server e client.
 * Não importar módulos `server-only` aqui.
 */

export type TrackingStatus =
  | "pending"
  | "in_transit"
  | "transshipment"
  | "arrived"
  | "discharged"
  | "delivered"
  | "empty_returned"
  | "not_found"
  | "blocked"
  | "error";

export type TrackingQueryType = "bl" | "container" | "booking";

/**
 * Divergência entre o navio extraído do BL e o navio informado pelo portal do
 * armador. Rollover/transbordo é legítimo: o rastreio continua válido e o
 * portal é a fonte mais recente do embarque — a divergência só é sinalizada.
 */
export type TrackingVesselMismatch = {
  /** Navio do BL (`raw.expectedVessel`). */
  expected: string;
  /** Navio devolvido pelo portal. */
  found: string;
};

type TrackingStrategy = "http" | "firecrawl" | "link" | "manual";

type TrackingSource = "scrape" | "manual";

export type TrackingEvent = {
  id: string;
  shipmentId: string;
  eventAt: string;
  status: string;
  location: string | null;
  description: string | null;
  vessel: string | null;
  voyage: string | null;
  containerNumber: string | null;
  source: TrackingSource;
  createdAt: string;
};

export type TrackingShipment = {
  id: string;
  importId: string;
  carrierCode: string;
  strategy: TrackingStrategy;
  queryType: TrackingQueryType;
  queryValue: string;
  containerNumber: string | null;
  status: TrackingStatus;
  vessel: string | null;
  voyage: string | null;
  eta: string | null;
  lastEventAt: string | null;
  lastEventLocation: string | null;
  lastEventDescription: string | null;
  source: TrackingSource;
  fetchedAt: string | null;
  nextCheckAt: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ImportTracking = {
  shipments: TrackingShipment[];
  events: TrackingEvent[];
  creditsUsedThisMonth: number;
  creditBudget: number;
};

const TRACKING_STATUS_LABELS: Record<
  TrackingStatus,
  {
    label: string;
    variant:
      | "default"
      | "secondary"
      | "destructive"
      | "success"
      | "warning"
      | "outline";
  }
> = {
  pending: { label: "Aguardando rastreio", variant: "secondary" },
  in_transit: { label: "Em trânsito", variant: "default" },
  transshipment: { label: "Em transbordo", variant: "warning" },
  arrived: { label: "Chegou ao porto", variant: "default" },
  discharged: { label: "Descarregado", variant: "success" },
  delivered: { label: "Entregue", variant: "success" },
  empty_returned: { label: "Vazio devolvido", variant: "outline" },
  not_found: { label: "Não encontrado", variant: "outline" },
  blocked: { label: "Rastreio bloqueado", variant: "warning" },
  error: { label: "Falha no rastreio", variant: "destructive" },
};

/** Todos os status possíveis (`tracking_shipments.status`). */
export const TRACKING_STATUSES = Object.keys(
  TRACKING_STATUS_LABELS,
) as TrackingStatus[];

export function trackingStatusLabel(status: string): {
  label: string;
  variant:
    | "default"
    | "secondary"
    | "destructive"
    | "success"
    | "warning"
    | "outline";
} {
  return (
    TRACKING_STATUS_LABELS[status as TrackingStatus] ?? {
      label: status,
      variant: "outline",
    }
  );
}

/** Status "finais": não precisam mais de atualização automática. */
export function isTerminalTrackingStatus(status: string): boolean {
  return status === "delivered" || status === "empty_returned";
}

/** Status considerados "em trânsito" na tela de rastreio. */
export function isInTransitTrackingStatus(status: string): boolean {
  return status === "in_transit" || status === "transshipment";
}

/**
 * Texto da "próxima consulta": a data agendada quando existe; "Concluído" só
 * em status final. Sem agenda e ainda ativo, o cron vai reagendar — mostrar
 * "Concluído" ali daria a impressão de que o rastreio parou.
 */
export function trackingNextCheckLabel(
  status: string,
  nextCheckAt: string | null | undefined,
): string {
  const moment = formatTrackingMoment(nextCheckAt);
  if (moment) return moment;
  return isTerminalTrackingStatus(status) ? "Concluído" : "Aguardando consulta";
}

/**
 * Filtros da tela `/rastreio`. Viram links (`?filtro=...`), então não dependem
 * de JavaScript no client.
 */
export const TRACKING_LIST_FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "transito", label: "Em trânsito" },
  { value: "chegando", label: "Chegando (≤ 7 dias)" },
  { value: "sem_eta", label: "Sem ETA" },
  { value: "sem_consulta", label: "Sem consulta" },
] as const;

export type TrackingListFilter =
  (typeof TRACKING_LIST_FILTERS)[number]["value"];

/** Normaliza o `?filtro=` da URL; valor desconhecido cai em "todos". */
export function normalizeTrackingListFilter(
  value: string | null | undefined,
): TrackingListFilter {
  return TRACKING_LIST_FILTERS.some((option) => option.value === value)
    ? (value as TrackingListFilter)
    : "todos";
}

/** Link da tela de rastreio preservando o filtro por importação. */
export function trackingListHref(params: {
  importId?: string | null;
  filter?: TrackingListFilter | null;
}): string {
  const search = new URLSearchParams();
  const importId = params.importId?.trim();
  if (importId) search.set("import", importId);
  const filter = params.filter ?? "todos";
  if (filter !== "todos") search.set("filtro", filter);
  const query = search.toString();
  return query ? `/rastreio?${query}` : "/rastreio";
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const BR_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

type DateParts = { year: number; month: number; day: number };

/** Partes de uma data de rastreio (aceita ISO `YYYY-MM-DD` e `DD/MM/AAAA`). */
function trackingDateParts(
  value: string | null | undefined,
): DateParts | null {
  const raw = value?.trim();
  if (!raw) return null;

  const iso = ISO_DATE_RE.exec(raw);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
    };
  }

  const br = BR_DATE_RE.exec(raw);
  if (br) {
    return {
      year: Number(br[3]),
      month: Number(br[2]),
      day: Number(br[1]),
    };
  }

  return null;
}

/** `DD/MM/AAAA`; datas ISO puras não passam por `Date` (evita fuso). */
export function formatTrackingDate(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const parts = trackingDateParts(raw);
  if (parts) {
    return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** `DD/MM/AAAA HH:MM` para timestamps; data pura continua só com o dia. */
export function formatTrackingMoment(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  // Data pura (ISO ou pt-BR): não inventa horário.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) || BR_DATE_RE.test(raw)) {
    return formatTrackingDate(raw);
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return formatTrackingDate(raw) ?? raw;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Dias entre hoje e o ETA (negativo quando o ETA já passou). Compara dias
 * locais para não deslocar a data por causa do horário/fuso.
 */
export function trackingDaysUntilEta(
  eta: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const parts = trackingDateParts(eta);
  if (!parts) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(parts.year, parts.month - 1, parts.day).getTime();
  return Math.round((target - today) / DAY_MS);
}

export type TrackingEtaRelative = {
  label: string;
  tone: "muted" | "danger";
};

/**
 * Texto do ETA para lista e timeline: "hoje", "em 3 dias" ou "atrasado 2 dias".
 * Só embarques em trânsito recebem o texto; chegou/entregue fica só com a data,
 * para não acusar atraso em carga que já foi descarregada.
 */
export function trackingEtaRelative(
  eta: string | null | undefined,
  status: string,
  now: Date = new Date(),
): TrackingEtaRelative | null {
  if (!isInTransitTrackingStatus(status)) return null;
  const days = trackingDaysUntilEta(eta, now);
  if (days === null) return null;
  if (days === 0) return { label: "hoje", tone: "muted" };

  const absolute = Math.abs(days);
  const unit = absolute === 1 ? "dia" : "dias";
  return days > 0
    ? { label: `em ${absolute} ${unit}`, tone: "muted" }
    : { label: `atrasado ${absolute} ${unit}`, tone: "danger" };
}
