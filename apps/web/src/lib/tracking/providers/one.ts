import "server-only";

import { z } from "zod";
import {
  inferTrackingStatus,
  parseTrackingDate,
  trackingEventFingerprint,
  type NormalizedTrackingEvent,
  type NormalizedTrackingSnapshot,
} from "@/lib/tracking/normalize";
import type { TrackingQueryType, TrackingStatus } from "@/lib/tracking/shared";
import { normalizeTrackingNumber } from "@/lib/tracking/validate";

const API_URL = "https://ecomm.one-line.com/api";
const PAGE_URL =
  "https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** Limite de containers com timeline detalhada por consulta (0 créditos). */
const MAX_CONTAINER_DETAILS = 8;
const REQUEST_TIMEOUT_MS = 30_000;

/** Tipo de busca aceito pela API interna (`search_type`). */
type OneSearchType = "BKG_NO" | "CNTR_NO";

const SEARCH_TYPE_BY_QUERY: Record<TrackingQueryType, OneSearchType> = {
  bl: "BKG_NO",
  booking: "BKG_NO",
  container: "CNTR_NO",
};

/** Código do parâmetro `trakNoTpCdParam` usado na URL pública do portal. */
const QUERY_TYPE_CODE: Record<TrackingQueryType, string> = {
  bl: "B",
  booking: "B",
  container: "C",
};

/**
 * Deep link do portal: a página lê `trakNoParam`/`trakNoTpCdParam` e dispara a
 * busca sozinha (B = BL/booking, C = container).
 */
export function buildOneScrapeUrl(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): string | null {
  const value = normalizeTrackingNumber(params.queryValue);
  const code = QUERY_TYPE_CODE[params.queryType];
  if (!value || !code) return null;

  const url = new URL(PAGE_URL);
  url.searchParams.set("trakNoParam", value);
  url.searchParams.set("trakNoTpCdParam", code);
  return url.toString();
}

const onePortSchema = z.object({
  code: z.string().nullish(),
  locationName: z.string().nullish(),
  countryName: z.string().nullish(),
});

const oneSearchVesselSchema = z.object({
  vesselName: z.string().nullish(),
  voyageNo: z.string().nullish(),
  inboundConsortiumVoyage: z.string().nullish(),
  outboundConsortiumVoyage: z.string().nullish(),
});

const oneSearchEventSchema = z.object({
  eventName: z.string().nullish(),
  locationName: z.string().nullish(),
  date: z.string().nullish(),
});

const oneSearchRowSchema = z.object({
  bookingNo: z.string(),
  bookingNoShow: z.string().nullish(),
  containerNo: z.string().nullish(),
  containerTypeSize: z.string().nullish(),
  latestEvent: oneSearchEventSchema.nullish(),
  por: onePortSchema.nullish(),
  pod: onePortSchema.nullish(),
  vesselVoyage: oneSearchVesselSchema.nullish(),
});

const oneSearchResponseSchema = z.object({
  status: z.number().nullish(),
  code: z.number().nullish(),
  total: z.number().nullish(),
  data: z.array(z.unknown()).nullish(),
});

const oneCopVesselSchema = z.object({
  code: z.string().nullish(),
  name: z.string().nullish(),
  voyNo: z.string().nullish(),
  inboundConsortiumVoyage: z.string().nullish(),
});

const oneCopEventSchema = z.object({
  eventName: z.string(),
  eventDate: z.string().nullish(),
  eventLocalPortDate: z.string().nullish(),
  triggerType: z.string().nullish(),
  location: onePortSchema.nullish(),
  yard: z.object({ yardName: z.string().nullish() }).nullish(),
  vessel: oneCopVesselSchema.nullish(),
  edhVessel: oneCopVesselSchema.nullish(),
});

const oneCopResponseSchema = z.object({
  status: z.number().nullish(),
  code: z.number().nullish(),
  data: z.array(z.unknown()).nullish(),
});

const oneValidateBookingSchema = z.object({
  status: z.number().nullish(),
  data: z
    .object({
      bkgBefore: z.string().nullish(),
      bkgAfter: z.string().nullish(),
    })
    .nullish(),
});

type OneSearchRow = z.infer<typeof oneSearchRowSchema>;
type OneCopEvent = z.infer<typeof oneCopEventSchema>;

/** Timeline detalhada de um container (resposta de `cop-events`). */
export type OneCopEventsPayload = {
  containerNumber: string | null;
  payload: unknown;
};

export type OneTrackingResult =
  | { ok: true; snapshot: NormalizedTrackingSnapshot; httpStatus: number }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      httpStatus: number | null;
    };

function isoMoment(
  value: string | null | undefined,
): { date: string; time: string } | null {
  const parsed = parseTrackingDate(value ?? null);
  if (!parsed) return null;
  return { date: parsed.slice(0, 10), time: parsed };
}

/**
 * Traduz o nome do evento da ONE para o status canônico. Eventos de previsão
 * (`triggerType` diferente de ACTUAL) nunca viram "arrived"/"discharged".
 */
export function oneEventStatus(
  eventName: string,
  triggerType: string | null | undefined = "ACTUAL",
): TrackingStatus {
  const text = eventName.toLowerCase();
  const actual = (triggerType ?? "ACTUAL").trim().toUpperCase() === "ACTUAL";
  if (!actual) return "in_transit";

  if (/empty container returned|returned empty|empty return/.test(text)) {
    return "empty_returned";
  }
  if (/empty container release/.test(text)) return "pending";
  if (/gate in to outbound/.test(text)) return "pending";
  if (/t\/s port|transship/.test(text)) {
    return /depart/.test(text) ? "in_transit" : "transshipment";
  }
  if (/arriv|berth/.test(text)) return "arrived";
  if (/unload|discharg/.test(text)) return "discharged";
  return inferTrackingStatus(eventName) ?? "in_transit";
}

/** Navio/viagem do trecho oceânico (evento de embarque no POL, senão cabeçalho). */
function pickOceanVessel(
  rows: OneSearchRow[],
  copEvents: Array<{ event: OneCopEvent; container: string | null }>,
): { vessel: string | null; voyage: string | null } {
  const loaded = copEvents.find(
    (entry) =>
      /loaded on vessel at port of loading/i.test(entry.event.eventName) &&
      entry.event.vessel?.name?.trim(),
  );

  if (loaded) {
    const voyage =
      loaded.event.edhVessel?.inboundConsortiumVoyage?.trim() ||
      loaded.event.vessel?.voyNo?.trim() ||
      null;
    return { vessel: loaded.event.vessel?.name?.trim() ?? null, voyage };
  }

  for (const row of rows) {
    const header = row.vesselVoyage;
    const vessel = header?.vesselName?.trim();
    if (!vessel) continue;
    return {
      vessel,
      voyage:
        header?.inboundConsortiumVoyage?.trim() ||
        header?.outboundConsortiumVoyage?.trim() ||
        header?.voyageNo?.trim() ||
        null,
    };
  }

  return { vessel: null, voyage: null };
}

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

function parseCopEvents(payload: unknown): OneCopEvent[] {
  const parsed = oneCopResponseSchema.safeParse(payload);
  if (!parsed.success) return [];

  const events: OneCopEvent[] = [];
  for (const raw of parsed.data.data ?? []) {
    const event = oneCopEventSchema.safeParse(raw);
    if (event.success) events.push(event.data);
  }
  return events;
}

/**
 * Converte as respostas da ONE (busca + `cop-events` por container) no snapshot
 * interno. Puro (sem fetch) para permitir teste com fixture real do BL
 * ONEYSZPGC3008300 / container TCKU7925277.
 */
export function normalizeOneResponse(
  search: unknown,
  fallbackContainer: string | null,
  copEvents: ReadonlyArray<OneCopEventsPayload> = [],
): NormalizedTrackingSnapshot {
  const parsed = oneSearchResponseSchema.safeParse(search);
  if (!parsed.success) {
    return emptySnapshot("error", "Resposta da ONE fora do formato esperado");
  }

  const rows: OneSearchRow[] = [];
  for (const raw of parsed.data.data ?? []) {
    const row = oneSearchRowSchema.safeParse(raw);
    if (row.success) rows.push(row.data);
  }

  if (rows.length === 0) {
    return emptySnapshot("not_found", "Sem resultado no portal da ONE");
  }

  const copByContainer = new Map<string, unknown>();
  for (const entry of copEvents) {
    const key = normalizeTrackingNumber(entry.containerNumber);
    if (key) copByContainer.set(key, entry.payload);
  }

  const events: NormalizedTrackingEvent[] = [];
  const containersSeen = new Set<string>();
  const parsedCop: Array<{ event: OneCopEvent; container: string | null }> = [];

  for (const row of rows) {
    const number =
      normalizeTrackingNumber(row.containerNo) ??
      normalizeTrackingNumber(fallbackContainer);
    if (number) containersSeen.add(number);

    const rawCop = number ? copByContainer.get(number) : undefined;
    const timeline = rawCop === undefined ? [] : parseCopEvents(rawCop);
    for (const event of timeline) {
      parsedCop.push({ event, container: number });
    }

    if (timeline.length === 0) {
      // Sem timeline detalhada: usa o evento resumido do cabeçalho da busca.
      const latest = row.latestEvent;
      const moment = isoMoment(latest?.date);
      const description = latest?.eventName?.trim();
      if (moment && description) {
        events.push({
          eventAt: moment.time,
          status: oneEventStatus(description),
          location: latest?.locationName?.trim() || null,
          description,
          containerNumber: number,
          vessel: null,
          voyage: null,
          fingerprint: trackingEventFingerprint([
            number,
            moment.time,
            description.toLowerCase().replace(/\s+/g, " "),
          ]),
        });
      }
      continue;
    }

    for (const event of timeline) {
      // `eventDate` é o horário UTC; `eventLocalPortDate` é o horário do porto
      // (sem offset real), então só serve de fallback.
      const moment = isoMoment(event.eventDate ?? event.eventLocalPortDate);
      if (!moment) continue;

      const description = event.eventName.trim();
      if (!description) continue;

      const voyage =
        event.edhVessel?.inboundConsortiumVoyage?.trim() ||
        event.vessel?.voyNo?.trim() ||
        null;

      events.push({
        eventAt: moment.time,
        status: oneEventStatus(description, event.triggerType),
        location: event.location?.locationName?.trim() || null,
        description,
        containerNumber: number,
        vessel: event.vessel?.name?.trim() || null,
        voyage,
        fingerprint: trackingEventFingerprint([
          number,
          moment.time,
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
  const { vessel, voyage } = pickOceanVessel(rows, parsedCop);

  const arrival = unique.find((event) =>
    /arrival at port of discharge/i.test(event.description),
  );
  const eta = arrival ? arrival.eventAt.slice(0, 10) : null;

  const transshipment = parsedCop
    .filter((entry) =>
      /loaded on vessel at transshipment port/i.test(entry.event.eventName),
    )
    .map((entry) => ({
      vessel: entry.event.vessel?.name?.trim() ?? null,
      voyage:
        entry.event.edhVessel?.inboundConsortiumVoyage?.trim() ||
        entry.event.vessel?.voyNo?.trim() ||
        null,
      location: entry.event.location?.locationName?.trim() ?? null,
    }))
    .find((entry) => entry.vessel);

  const notes = transshipment
    ? `Transbordo em ${transshipment.location ?? "porto de transbordo"} no ${transshipment.vessel}${
        transshipment.voyage ? ` ${transshipment.voyage}` : ""
      }`
    : null;

  return {
    found: unique.length > 0,
    status: latest?.status ?? "pending",
    vessel,
    voyage,
    eta,
    containers: Array.from(containersSeen),
    events: unique,
    notes,
  };
}

function requestHeaders(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    Origin: "https://www.one-line.com",
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

async function requestJson(
  url: string,
  init: { method: "GET" } | { method: "POST"; body: unknown },
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: requestHeaders(),
      body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      errorCode: "one_network_error",
      errorMessage: `Falha de rede ao consultar a ONE: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      errorCode: `one_http_${response.status}`,
      errorMessage: `ONE respondeu ${response.status}`,
    };
  }

  const json = await response.json().catch(() => null);
  if (json === null) {
    return {
      ok: false,
      status: response.status,
      errorCode: "one_invalid_response",
      errorMessage: "ONE respondeu um corpo que não é JSON",
    };
  }

  return { ok: true, status: response.status, json };
}

/**
 * BL vem no formato `ONEY` + booking (ex.: ONEYSZPGC3008300 → SZPGC3008300);
 * a API aceita o número cheio e devolve o booking legível.
 */
async function resolveBookingNumbers(
  value: string,
): Promise<
  | { ok: true; bookingNumbers: string[] }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      httpStatus: number | null;
    }
> {
  const result = await requestJson(
    `${API_URL}/v2/edh/containers/track-and-trace/validate-booking`,
    { method: "POST", body: { bookingNos: value } },
  );
  if (!result.ok) {
    return {
      ok: false,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      httpStatus: result.status,
    };
  }

  const parsed = oneValidateBookingSchema.safeParse(result.json);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: "one_invalid_response",
      errorMessage: "ONE devolveu um validate-booking inesperado",
      httpStatus: result.status,
    };
  }

  const bookingNumbers: string[] = [];
  const after = normalizeTrackingNumber(parsed.data.data?.bkgAfter);
  if (after) bookingNumbers.push(after);
  for (const legacy of (parsed.data.data?.bkgBefore ?? "").split(",")) {
    const normalized = normalizeTrackingNumber(legacy);
    if (normalized && !bookingNumbers.includes(normalized)) {
      bookingNumbers.push(normalized);
    }
  }

  return { ok: true, bookingNumbers };
}

async function searchShipments(
  searchType: OneSearchType,
  searchValue: string,
): Promise<HttpResult> {
  return requestJson(`${API_URL}/v2/edh/containers/track-and-trace/search`, {
    method: "POST",
    body: {
      page: 1,
      page_length: 50,
      filters: { search_text: searchValue, search_type: searchType },
    },
  });
}

/** Consulta a API interna da ONE (sem créditos de Firecrawl e sem captcha). */
export async function fetchOneTracking(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): Promise<OneTrackingResult> {
  const value = normalizeTrackingNumber(params.queryValue);
  if (!value) {
    return {
      ok: false,
      errorCode: "one_invalid_query",
      errorMessage: "Número de rastreio inválido",
      httpStatus: null,
    };
  }

  const searchType = SEARCH_TYPE_BY_QUERY[params.queryType];
  const candidates: string[] = [];

  if (searchType === "BKG_NO") {
    const resolved = await resolveBookingNumbers(value);
    if (!resolved.ok) {
      return {
        ok: false,
        errorCode: resolved.errorCode,
        errorMessage: resolved.errorMessage,
        httpStatus: resolved.httpStatus,
      };
    }
    candidates.push(...resolved.bookingNumbers);
    if (candidates.length === 0) {
      // BL de casa (forwarder) ou número inexistente: deixa o serviço cair
      // para o fan-out dos containers.
      return {
        ok: true,
        snapshot: emptySnapshot(
          "not_found",
          "BL não reconhecido pelo portal da ONE",
        ),
        httpStatus: 200,
      };
    }
  } else {
    candidates.push(value);
  }

  let httpStatus: number | null = null;
  let lastSearch: unknown = null;

  for (const candidate of candidates.slice(0, 3)) {
    const result = await searchShipments(searchType, candidate);
    if (!result.ok) {
      return {
        ok: false,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        httpStatus: result.status,
      };
    }
    httpStatus = result.status;
    lastSearch = result.json;

    const parsed = oneSearchResponseSchema.safeParse(result.json);
    if (parsed.success && (parsed.data.data ?? []).length > 0) break;
  }

  const parsedSearch = oneSearchResponseSchema.safeParse(lastSearch);
  const rows: Array<{ bookingNo: string; containerNumber: string | null }> = [];
  if (parsedSearch.success) {
    for (const raw of parsedSearch.data.data ?? []) {
      const row = oneSearchRowSchema.safeParse(raw);
      if (!row.success) continue;
      const containerNumber = normalizeTrackingNumber(row.data.containerNo);
      if (rows.some((item) => item.containerNumber === containerNumber))
        continue;
      rows.push({ bookingNo: row.data.bookingNo, containerNumber });
    }
  }

  const copEvents: OneCopEventsPayload[] = [];
  for (const row of rows.slice(0, MAX_CONTAINER_DETAILS)) {
    if (!row.containerNumber) continue;

    const detail = await requestJson(
      `${API_URL}/v2/edh/containers/track-and-trace/cop-events?booking_no=${encodeURIComponent(
        row.bookingNo,
      )}&container_no=${encodeURIComponent(row.containerNumber)}`,
      { method: "GET" },
    );
    if (detail.ok) {
      copEvents.push({
        containerNumber: row.containerNumber,
        payload: detail.json,
      });
    }
  }

  return {
    ok: true,
    snapshot: normalizeOneResponse(lastSearch, value, copEvents),
    httpStatus: httpStatus ?? 200,
  };
}
