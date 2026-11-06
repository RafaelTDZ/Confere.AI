import "server-only";

import { z } from "zod";
import {
  parseTrackingDate,
  trackingEventFingerprint,
  type NormalizedTrackingEvent,
  type NormalizedTrackingSnapshot,
} from "@/lib/tracking/normalize";
import type { TrackingQueryType, TrackingStatus } from "@/lib/tracking/shared";
import {
  normalizeTrackingNumber,
  validContainerNumbers,
} from "@/lib/tracking/validate";

const BASE_URL = "https://mykn.kuehne-nagel.com";
const PAGE_URL = `${BASE_URL}/public-tracking/shipments`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const REQUEST_TIMEOUT_MS = 25_000;
/** Consultas que devolvem vários embarques (ex.: container reutilizado). */
const MAX_CANDIDATES = 3;

/** Deep link do portal público: a SPA lê `query` e dispara a busca sozinha. */
export function buildKuehneScrapeUrl(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): string | null {
  const value = params.queryValue.trim();
  if (!normalizeTrackingNumber(value)) return null;

  const url = new URL(PAGE_URL);
  url.searchParams.set("query", value);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Schemas (respostas internas do myKN público)
// ---------------------------------------------------------------------------

const kuehneDateTimeSchema = z.object({
  date: z.string().nullish(),
  time: z.string().nullish(),
  offset: z.string().nullish(),
  localDateTime: z.string().nullish(),
  offsetDateTime: z.string().nullish(),
});

const kuehneAchievementSchema = z.object({
  condition: z.string().nullish(),
  dateTime: kuehneDateTimeSchema.nullish(),
});

const kuehneLocationSchema = z.object({
  locationCode: z.string().nullish(),
  unLocationCode: z.string().nullish(),
  countryCode: z.string().nullish(),
  countryName: z.string().nullish(),
  internationalName: z.string().nullish(),
});

const kuehneLocationMilestoneSchema = z.object({
  labelIdentifier: z.string(),
  reached: z.boolean().nullish(),
  achievementDateTime: kuehneAchievementSchema.nullish(),
  actualAchievementDateTime: kuehneAchievementSchema.nullish(),
  plannedAchievementDateTime: kuehneAchievementSchema.nullish(),
});

const kuehneVehicleSchema = z.object({
  vesselName: z.string().nullish(),
  voyageNumber: z.string().nullish(),
  lloydsRegisterCode: z.string().nullish(),
});

const kuehneRouteLocationSchema = z.object({
  source: z.string().nullish(),
  reached: z.boolean().nullish(),
  completed: z.boolean().nullish(),
  labelIdentifier: z.string(),
  location: kuehneLocationSchema.nullish(),
  locationMilestones: z.array(kuehneLocationMilestoneSchema).default([]),
  outgoingVehicle: kuehneVehicleSchema.nullish(),
});

const kuehneRoutingSchema = z.object({
  modeOfTransport: z.string().nullish(),
  routeLocations: z.array(kuehneRouteLocationSchema).default([]),
});

const kuehneContentSchema = z.object({
  serviceType: z.string().nullish(),
  countOfContainer: z.number().nullish(),
  container: z
    .array(
      z.object({
        containerNumber: z.string().nullish(),
        containerType: z.string().nullish(),
      }),
    )
    .default([]),
});

const kuehneAbstractSchema = z.object({
  primaryReference: z.string().nullish(),
  modeOfTransport: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
  stage: z.string().nullish(),
  currentMilestone: z.string().nullish(),
  currentMilestoneLocation: z.string().nullish(),
  currentMilestoneDate: z.string().nullish(),
});

const kuehneShipmentSchema = z.object({
  id: z.number(),
  modeOfTransport: z.string().nullish(),
  trackingNumber: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
  stage: z.string().nullish(),
});

const kuehneShipmentListSchema = z.object({
  totalResults: z.number().nullish(),
  searchResultsByType: z
    .array(
      z.object({
        kind: z.string(),
        numberOfResults: z.number().nullish(),
        shipments: z.array(z.unknown()).default([]),
      }),
    )
    .default([]),
});

type KuehneRouteLocation = z.infer<typeof kuehneRouteLocationSchema>;
type KuehneLocationMilestone = z.infer<typeof kuehneLocationMilestoneSchema>;
type KuehneDateTime = z.infer<typeof kuehneDateTimeSchema>;

export type KuehneCandidate = {
  id: number;
  kind: string;
  modeOfTransport: string | null;
  trackingNumber: string | null;
  stage: string | null;
};

export type KuehneDetailPayloads = {
  abstract?: unknown;
  content?: unknown;
  routing?: unknown;
};

export type KuehneTrackingResult =
  | { ok: true; snapshot: NormalizedTrackingSnapshot; httpStatus: number }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      httpStatus: number | null;
    };

function emptySnapshot(
  status: TrackingStatus,
  notes: string | null,
): NormalizedTrackingSnapshot {
  return {
    found: false,
    status,
    vessel: null,
    voyage: null,
    eta: null,
    containers: [],
    events: [],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Seleção do embarque
// ---------------------------------------------------------------------------

/**
 * Tipos de referência que o portal usa na busca (`kind` do `shipment-list`).
 * O BL da Kuehne + Nagel (NVOCC) aparece como `reference.OBL`; o container,
 * como `reference.CN`; o booking, como `reference.BI`/`reference.BN`.
 */
const KIND_PRIORITY: Record<TrackingQueryType, readonly string[]> = {
  bl: [
    "reference.OBL",
    "reference.BOL",
    "reference.MBL",
    "reference.BL",
    "reference.TN",
    "reference.SN",
    "reference.MAW",
    "reference.HAW",
    "reference.BI",
    "reference.BN",
    "reference.KNE",
    "reference.KNI",
  ],
  container: ["reference.CN", "reference.TN", "reference.SN"],
  booking: ["reference.BI", "reference.BN", "reference.SN", "reference.TN"],
};

/**
 * Embarques candidatos de uma busca, do mais provável ao menos provável.
 *
 * O portal devolve resultados agrupados por tipo de referência e a busca é
 * textual (um container pode aparecer em mais de um embarque). O serviço
 * confirma o candidato pelo `content` antes de aceitar o snapshot.
 */
export function selectKuehneCandidates(
  raw: unknown,
  queryType: TrackingQueryType,
  queryValue: string,
): KuehneCandidate[] {
  const parsed = kuehneShipmentListSchema.safeParse(raw);
  if (!parsed.success) return [];

  const normalizedQuery = normalizeTrackingNumber(queryValue);
  const preferredKinds = KIND_PRIORITY[queryType];
  const byId = new Map<number, { candidate: KuehneCandidate; score: number }>();

  for (const group of parsed.data.searchResultsByType) {
    const kind = group.kind ?? "";
    for (const rawShipment of group.shipments) {
      const shipment = kuehneShipmentSchema.safeParse(rawShipment);
      if (!shipment.success) continue;

      const candidate: KuehneCandidate = {
        id: shipment.data.id,
        kind,
        modeOfTransport: shipment.data.modeOfTransport?.trim() || null,
        trackingNumber: shipment.data.trackingNumber?.trim() || null,
        stage: shipment.data.stage?.trim() || null,
      };

      let score = 0;
      if (
        normalizedQuery &&
        normalizeTrackingNumber(candidate.trackingNumber) === normalizedQuery
      ) {
        score += 1_000;
      }
      const kindIndex = preferredKinds.indexOf(kind);
      if (kindIndex >= 0) score += 100 + (preferredKinds.length - kindIndex);
      if (queryType === "container" && kind === "reference.CN") score += 100;
      if (queryType === "bl" && /OBL|BOL/i.test(kind)) score += 100;
      if (candidate.modeOfTransport?.toLowerCase() === "sea") score += 20;

      const current = byId.get(candidate.id);
      if (!current || score > current.score) {
        byId.set(candidate.id, { candidate, score });
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.candidate);
}

// ---------------------------------------------------------------------------
// Normalização (pura, sem rede)
// ---------------------------------------------------------------------------

function dateTimeIso(value: KuehneDateTime | null | undefined): string | null {
  // `localDateTime` é o horário do porto (sem offset); `date` é a data pura.
  const raw = value?.localDateTime?.trim() || value?.date?.trim();
  return raw ? parseTrackingDate(raw) : null;
}

function milestoneMoment(milestone: KuehneLocationMilestone): {
  iso: string | null;
  actual: boolean;
} {
  const actual = milestone.actualAchievementDateTime?.dateTime;
  const achievement = milestone.achievementDateTime?.dateTime;
  const achievementCondition = (
    milestone.achievementDateTime?.condition ?? ""
  ).toUpperCase();
  const planned = milestone.plannedAchievementDateTime?.dateTime;

  if (actual) return { iso: dateTimeIso(actual), actual: true };
  if (achievementCondition === "ACTUAL") {
    return { iso: dateTimeIso(achievement), actual: true };
  }
  if (achievement) return { iso: dateTimeIso(achievement), actual: false };
  return { iso: dateTimeIso(planned), actual: false };
}

/** `location-milestone.departure.vehicle-departed.sea` → partes. */
function kuehneMilestoneParts(labelIdentifier: string): {
  section: string;
  milestone: string;
  mode: string;
} {
  const parts = labelIdentifier.split(".");
  return {
    section: parts[1] ?? "",
    milestone: parts[2] ?? "",
    mode: parts[3] ?? "",
  };
}

const MILESTONE_LABELS: Record<string, string> = {
  "vehicle-arrived": "Chegada",
  "vehicle-departed": "Partida",
  "vehicle-loaded": "Carregado",
  "vehicle-discharged": "Descarregado",
  "container-loaded": "Carregado no container",
  "container-unloaded": "Descarregado do container",
  "container-gate-out-empty": "Saída do vazio (gate out)",
  "container-gate-in-empty": "Devolução do vazio (gate in)",
  "gate-in": "Gate in",
  "gate-out": "Gate out",
  "ready-for-pickup": "Disponível para coleta",
  "cargo-picked-up": "Carga coletada",
  "cargo-delivered": "Carga entregue",
  "cargo-available": "Carga disponível",
  "cargo-at-carrier": "Carga recebida pela transportadora",
  "cargo-checked-in": "Carga check-in",
  "cargo-handed-over": "Carga transferida",
  "in-delivery": "Em entrega",
  "freight-collection": "Coleta de frete",
};

const SECTION_LABELS: Record<string, string> = {
  departure: "no porto de embarque",
  transit: "em trânsito",
  "gateway-station": "em transbordo",
  arrival: "no porto de chegada",
};

function sectionLabel(section: string): string | null {
  if (SECTION_LABELS[section]) return SECTION_LABELS[section];
  if (section.startsWith("transshipment")) return "em transbordo";
  if (section.startsWith("origin")) return "na origem";
  if (section.startsWith("destination")) return "no destino";
  return null;
}

/** Descrição legível do marco (o portal só devolve o identificador). */
export function kuehneMilestoneDescription(labelIdentifier: string): string {
  const { section, milestone } = kuehneMilestoneParts(labelIdentifier);
  const base =
    MILESTONE_LABELS[milestone] ??
    milestone.replace(/-/g, " ").replace(/^\w/, (char) => char.toUpperCase());
  const place = sectionLabel(section);
  return place ? `${base} — ${place}` : base;
}

/** Traduz o marco físico do portal para o status canônico. */
export function kuehneEventStatus(labelIdentifier: string): TrackingStatus {
  const { section, milestone } = kuehneMilestoneParts(labelIdentifier);

  if (/container-gate-in-empty|gate-in-empty/.test(milestone)) {
    return "empty_returned";
  }
  if (milestone === "cargo-delivered" || milestone === "service-complete") {
    return "delivered";
  }

  if (section === "arrival" || section.startsWith("destination")) {
    if (
      milestone === "vehicle-discharged" ||
      milestone === "container-unloaded"
    ) {
      return "discharged";
    }
    if (
      milestone === "vehicle-arrived" ||
      milestone === "cargo-available" ||
      milestone === "ready-for-pickup"
    ) {
      return "arrived";
    }
    return "in_transit";
  }

  if (
    section === "transit" ||
    section === "gateway-station" ||
    section.startsWith("transshipment")
  ) {
    if (
      milestone === "vehicle-arrived" ||
      milestone === "vehicle-discharged" ||
      milestone === "container-unloaded"
    ) {
      return "transshipment";
    }
    return "in_transit";
  }

  if (section === "departure") {
    return milestone === "vehicle-departed" || milestone === "vehicle-loaded"
      ? "in_transit"
      : "pending";
  }

  // Origem / coleta: a carga ainda não saiu.
  return "pending";
}

function stageStatus(stage: string | null | undefined): TrackingStatus {
  const text = (stage ?? "").toLowerCase();
  if (!text) return "pending";
  if (/deliver|complete/.test(text)) return "delivered";
  if (/arriv/.test(text)) return "arrived";
  if (/transit|depart|sail|load|pick/.test(text)) return "in_transit";
  return "pending";
}

function formatLocation(
  location: z.infer<typeof kuehneLocationSchema> | null | undefined,
): string | null {
  const name =
    location?.internationalName?.trim() || location?.locationCode?.trim();
  if (!name) return null;
  const country = location?.countryCode?.trim();
  return country ? `${name} / ${country}` : name;
}

function routeSection(location: KuehneRouteLocation): string {
  return location.labelIdentifier.split(".")[1] ?? "";
}

/** Navio/viagem do trecho oceânico (partida), com fallback para o último trecho. */
function pickKuehneVessel(locations: KuehneRouteLocation[]): {
  vessel: string | null;
  voyage: string | null;
} {
  const departure = locations.find((location) => {
    const section = routeSection(location);
    return section === "departure" && location.outgoingVehicle?.vesselName;
  });
  const vehicle =
    departure?.outgoingVehicle ??
    [...locations].reverse().find((location) => location.outgoingVehicle)
      ?.outgoingVehicle;

  return {
    vessel: vehicle?.vesselName?.trim() || null,
    voyage: vehicle?.voyageNumber?.trim() || null,
  };
}

/** ETA/chegada real do destino a partir dos marcos do roteiro. */
function pickKuehneEta(locations: KuehneRouteLocation[]): string | null {
  const arrival =
    locations.find((location) => routeSection(location) === "arrival") ??
    [...locations]
      .reverse()
      .find((location) => routeSection(location).startsWith("destination"));
  if (!arrival) return null;

  const preferred =
    arrival.locationMilestones.find((milestone) =>
      /vehicle-arrived|cargo-available|ready-for-pickup/.test(
        milestone.labelIdentifier,
      ),
    ) ?? arrival.locationMilestones[0];
  if (!preferred) return null;

  const moment = milestoneMoment(preferred);
  return moment.iso ? moment.iso.slice(0, 10) : null;
}

/** Containers que o portal atribui ao embarque (sem o valor consultado). */
function reportedContainers(detail: KuehneDetailPayloads): string[] {
  const content = kuehneContentSchema.safeParse(detail.content);
  if (!content.success) return [];
  return validContainerNumbers(
    content.data.container.map((container) => container.containerNumber),
    12,
  );
}

/**
 * Converte as respostas do portal público da Kuehne + Nagel no snapshot
 * interno. Puro (sem fetch) para permitir teste com fixture real.
 */
export function normalizeKuehneResponse(
  detail: KuehneDetailPayloads,
  fallbackContainer: string | null = null,
): NormalizedTrackingSnapshot {
  const abstract = kuehneAbstractSchema.safeParse(detail.abstract);
  const content = kuehneContentSchema.safeParse(detail.content);
  const routing = kuehneRoutingSchema.safeParse(detail.routing);

  if (!abstract.success && !routing.success && !content.success) {
    return emptySnapshot(
      "error",
      "Resposta da Kuehne + Nagel fora do formato esperado",
    );
  }

  const fallback = validContainerNumbers([fallbackContainer], 1)[0] ?? null;
  const containers = reportedContainers(detail);
  if (fallback && !containers.includes(fallback)) containers.push(fallback);

  const singleContainer =
    containers.length === 1 ? (containers[0] ?? null) : null;
  const eventContainer = fallback ?? singleContainer;
  const locations = routing.success ? routing.data.routeLocations : [];

  const events: NormalizedTrackingEvent[] = [];
  for (const location of locations) {
    if (location.locationMilestones.length === 0) continue;

    const locationName = formatLocation(location.location);
    const vessel = location.outgoingVehicle?.vesselName?.trim() || null;
    const voyage = location.outgoingVehicle?.voyageNumber?.trim() || null;

    for (const milestone of location.locationMilestones) {
      // A timeline mostra só marcos concluídos; previsão vira ETA, não evento.
      const moment = milestoneMoment(milestone);
      if (!moment.actual || !moment.iso) continue;

      const description = kuehneMilestoneDescription(milestone.labelIdentifier);
      events.push({
        eventAt: moment.iso,
        status: kuehneEventStatus(milestone.labelIdentifier),
        location: locationName,
        description,
        containerNumber: eventContainer,
        vessel,
        voyage,
        fingerprint: trackingEventFingerprint([
          eventContainer,
          moment.iso,
          description.toLowerCase().replace(/\s+/g, " "),
        ]),
      });
    }
  }

  events.sort((a, b) => b.eventAt.localeCompare(a.eventAt));
  const unique: NormalizedTrackingEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.fingerprint)) continue;
    seen.add(event.fingerprint);
    unique.push(event);
  }

  const latest = unique[0];
  let status: TrackingStatus =
    latest?.status ??
    stageStatus(abstract.success ? abstract.data.stage : null);

  // Chegada/descarga com data futura é previsão, não evento concluído.
  if (
    latest &&
    (status === "arrived" || status === "discharged") &&
    Date.parse(latest.eventAt) > Date.now()
  ) {
    status = "in_transit";
  }

  const { vessel, voyage } = pickKuehneVessel(locations);
  const found =
    abstract.success ||
    routing.success ||
    content.success ||
    containers.length > 0;

  return {
    found,
    status: found ? status : "not_found",
    vessel,
    voyage,
    eta: pickKuehneEta(locations),
    containers,
    events: unique,
    notes: found ? null : "Sem resultado no portal da Kuehne + Nagel",
  };
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

function requestHeaders(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    Referer: PAGE_URL,
  };
}

type HttpResult =
  | { ok: true; status: number; json: unknown }
  | {
      ok: false;
      status: number | null;
      errorCode: string;
      errorMessage: string;
    };

async function requestJson(path: string): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      errorCode: "kuehne_network_error",
      errorMessage: `Falha de rede ao consultar a Kuehne + Nagel: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      errorCode: `kuehne_http_${response.status}`,
      errorMessage: `Kuehne + Nagel respondeu ${response.status}`,
    };
  }

  const json = await response.json().catch(() => null);
  if (json === null) {
    return {
      ok: false,
      status: response.status,
      errorCode: "kuehne_invalid_response",
      errorMessage: "Kuehne + Nagel respondeu um corpo que não é JSON",
    };
  }

  return { ok: true, status: response.status, json };
}

/** Detalhes de um embarque; cada bloco pode falhar sem derrubar os demais. */
async function fetchDetail(id: number): Promise<KuehneDetailPayloads> {
  const base = `/public-tracking/internal/shipments/${id}`;
  const [abstract, content, routing] = await Promise.all([
    requestJson(`${base}/abstract`),
    requestJson(`${base}/content`),
    requestJson(`${base}/shipment-routing`),
  ]);

  return {
    abstract: abstract.ok ? abstract.json : null,
    content: content.ok ? content.json : null,
    routing: routing.ok ? routing.json : null,
  };
}

/**
 * Consulta o portal público da Kuehne + Nagel (0 créditos de Firecrawl).
 *
 * A busca devolve embarques agrupados por tipo de referência; para cada
 * candidato (até 3) os detalhes são carregados em paralelo e só é aceito o
 * embarque que contém o container consultado (a busca é textual e pode casar
 * com outro embarque que reutilizou o equipamento). Na busca por container, um
 * embarque sem eventos nem ETA pode ser uma reserva antiga do mesmo
 * equipamento: nesse caso os demais candidatos são tentados antes de aceitar o
 * primeiro.
 */
export async function fetchKuehneTracking(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): Promise<KuehneTrackingResult> {
  const value = params.queryValue.trim();
  if (!normalizeTrackingNumber(value)) {
    return {
      ok: false,
      errorCode: "kuehne_invalid_query",
      errorMessage: "Número de rastreio vazio",
      httpStatus: null,
    };
  }

  const list = await requestJson(
    `/public-tracking/internal/shipment-list?query=${encodeURIComponent(value)}`,
  );
  if (!list.ok) {
    return {
      ok: false,
      errorCode: list.errorCode,
      errorMessage: list.errorMessage,
      httpStatus: list.status,
    };
  }

  const candidates = selectKuehneCandidates(list.json, params.queryType, value);
  if (candidates.length === 0) {
    return {
      ok: true,
      snapshot: emptySnapshot(
        "not_found",
        "Sem resultado no portal da Kuehne + Nagel",
      ),
      httpStatus: list.status,
    };
  }

  const queryContainer = normalizeTrackingNumber(
    params.queryType === "container" ? value : null,
  );
  let fallback: NormalizedTrackingSnapshot | null = null;

  for (const candidate of candidates) {
    const detail = await fetchDetail(candidate.id);

    if (!detail.abstract && !detail.content && !detail.routing) {
      continue;
    }

    const snapshot = normalizeKuehneResponse(
      detail,
      params.queryType === "container" ? value : null,
    );

    // Busca por container: a API pode devolver embarques antigos do mesmo
    // equipamento. Só aceita o que lista o container consultado — o `content`
    // é a fonte, porque o snapshot injeta o valor consultado como fallback.
    const reported = reportedContainers(detail);
    if (
      params.queryType === "container" &&
      queryContainer &&
      reported.length > 0 &&
      !reported.includes(queryContainer)
    ) {
      continue;
    }

    const informative = snapshot.events.length > 0 || snapshot.eta !== null;
    if (params.queryType === "container" && !informative) {
      fallback ??= snapshot;
      continue;
    }

    return { ok: true, snapshot, httpStatus: list.status };
  }

  if (fallback) {
    return { ok: true, snapshot: fallback, httpStatus: list.status };
  }

  return {
    ok: true,
    snapshot: emptySnapshot(
      "not_found",
      "Sem resultado correspondente no portal da Kuehne + Nagel",
    ),
    httpStatus: list.status,
  };
}
