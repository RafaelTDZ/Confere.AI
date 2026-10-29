import "server-only";

import {
  inferTrackingStatus,
  parseTrackingDate,
  trackingEventFingerprint,
  type NormalizedTrackingEvent,
  type NormalizedTrackingSnapshot,
} from "@/lib/tracking/normalize";
import type { TrackingQueryType, TrackingStatus } from "@/lib/tracking/shared";
import {
  isValidContainerNumber,
  normalizeTrackingNumber,
} from "@/lib/tracking/validate";

const PAGE_URL =
  "https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do";
const API_URL =
  "https://www.hmm21.com/e-service/general/trackNTrace/selectTrackNTrace.do";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** HMM expõe o rastreio como HTML: o POST devolve o fragmento da tabela. */
type HmmQueryType = "bl" | "cntr" | "bkg";

/** A SPA da HMM precisa de ~9s após o submit para renderizar a timeline. */
export const HMM_WAIT_FOR_MS = 9_000;

const SEARCH_INPUTS: Record<HmmQueryType, string> = {
  bl: 'input[name="srchBlNo1"]',
  cntr: 'input[name="srchCntrNo1"]',
  bkg: 'input[name="srchBkgNo1"]',
};

/**
 * A URL da HMM não aceita o número na query string (a busca é feita por JS);
 * a página base é o ponto de partida para o fallback via Firecrawl.
 */
export function buildHmmScrapeUrl(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): string | null {
  if (!normalizeTrackingNumber(params.queryValue)) return null;
  return SEARCH_INPUTS[toHmmQueryType(params.queryType)] ? PAGE_URL : null;
}

/**
 * Ações do fallback Firecrawl: preenche o campo do tipo de consulta e clica em
 * "Search". Validado com o BL TSNM72593800 e o container KOCU4320185.
 */
export function buildHmmActions(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): Array<Record<string, unknown>> | undefined {
  const value = normalizeTrackingNumber(params.queryValue);
  if (!value) return undefined;

  return [
    { type: "wait", milliseconds: 4_000 },
    {
      type: "click",
      selector: SEARCH_INPUTS[toHmmQueryType(params.queryType)],
    },
    { type: "write", text: value },
    { type: "wait", milliseconds: 500 },
    { type: "click", selector: 'button[onclick="search()"]' },
    { type: "wait", milliseconds: HMM_WAIT_FOR_MS },
  ];
}

/** HMM expõe o rastreio como HTML: o POST devolve o fragmento da tabela. */
type HmmSession = { cookie: string; csrf: string; expiresAt: number };

type HtmlCell = { text: string; classes: string[] };

type VesselLeg = {
  vessel: string | null;
  voyage: string | null;
  loadingPort: string | null;
  dischargingPort: string | null;
  arrival: string | null;
  departure: string | null;
};

export type HmmTrackingResult =
  | { ok: true; snapshot: NormalizedTrackingSnapshot; httpStatus: number }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      httpStatus: number | null;
    };

const EMPTY_SNAPSHOT: NormalizedTrackingSnapshot = {
  found: false,
  status: "not_found",
  vessel: null,
  voyage: null,
  eta: null,
  containers: [],
  events: [],
  notes: null,
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Texto visível de um trecho de HTML (sem tags). */
function textOf(html: string): string {
  const withoutTags = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/** Células de uma linha, com as classes (azul = data estimada). */
function parseCells(rowHtml: string): HtmlCell[] {
  const cells: HtmlCell[] = [];
  const cellRe = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRe.exec(rowHtml)) !== null) {
    const attributes = match[1] ?? "";
    const classMatch = attributes.match(/class="([^"]*)"/i);
    cells.push({
      text: textOf(match[2] ?? ""),
      classes: (classMatch?.[1] ?? "").split(/\s+/).filter(Boolean),
    });
  }
  return cells;
}

function rowsOf(html: string): string[] {
  return Array.from(
    html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi),
    (m) => m[1] ?? "",
  );
}

/**
 * Separa "ONE PREMIUM 0092W" em navio e viagem. Retorna null quando o texto
 * não parece um navio (ex.: "Truck", "Rail", vazio).
 */
export function splitHmmVesselVoyage(
  value: string | null | undefined,
): { vessel: string; voyage: string } | null {
  const text = decodeEntities(value ?? "")
    .replace(/^\s*\[[A-Z0-9]{2,4}\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (/^(truck|rail|barge|train|trucking)$/i.test(text)) return null;

  const match = text.match(/^(.+?)\s+(\d{2,4}[A-Z]?|[A-Z]\d{2,5})$/);
  if (!match) return null;
  const vessel = match[1]?.trim();
  const voyage = match[2]?.trim();
  if (!vessel || !voyage) return null;
  return { vessel, voyage };
}

/** Traduz as descrições do rastreio da HMM para o status canônico. */
export function hmmEventStatus(description: string): TrackingStatus {
  const text = description.toLowerCase();
  if (/empty/.test(text) && /(return|returned)/.test(text))
    return "empty_returned";
  if (/delivered/.test(text)) return "delivered";
  if (/discharg/.test(text)) return "discharged";
  if (/arriv|berth/.test(text)) return "arrived";
  if (/gate\s*out/.test(text)) return "in_transit";
  if (/depart|loading|loaded|on\s*board|sailed/.test(text)) return "in_transit";
  // Gate in / vazio liberado no porto de origem ainda não embarcou.
  if (/gate\s*in|empty container released|received|receiv/.test(text)) {
    return /t\/s|transship/i.test(text) ? "in_transit" : "pending";
  }
  if (/transship|t\/s/.test(text)) return "transshipment";
  return inferTrackingStatus(description) ?? "in_transit";
}

function coerceContainer(value: string | null | undefined): string | null {
  const normalized = normalizeTrackingNumber(value);
  if (!normalized) return null;
  if (isValidContainerNumber(normalized)) return normalized;
  const prefix = normalized.slice(0, 11);
  return isValidContainerNumber(prefix) ? prefix : null;
}

function normalizePortName(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

/**
 * Cabeçalho do rastreio: origem/destino e a data de chegada. A cor da data
 * indica se já aconteceu (vermelho) ou é previsão (azul).
 */
function parseHmmRoute(html: string): {
  origin: string | null;
  destination: string | null;
  arrivalAt: string | null;
  arrivalEstimated: boolean;
} {
  const start = html.indexOf('class="route-wrap"');
  if (start < 0) {
    return {
      origin: null,
      destination: null,
      arrivalAt: null,
      arrivalEstimated: false,
    };
  }
  const end = html.indexOf("Shipment History", start);
  const slice = html.slice(start, end > start ? end : start + 6_000);

  const chunks = slice.split('<div class="location">').slice(1);
  let origin: string | null = null;
  let destination: string | null = null;
  let arrivalAt: string | null = null;
  let arrivalEstimated = false;

  for (const chunk of chunks) {
    const name = textOf(chunk.match(/<div>([\s\S]*?)<\/div>/)?.[1] ?? "");
    const dateMatch = chunk.match(
      /class="[^"]*text-nowrap[^"]*?(red|blue)[^"]*"[^>]*>([^<]*)</i,
    );
    const date = dateMatch?.[2]?.trim() ?? null;
    const color = dateMatch?.[1]?.toLowerCase() ?? null;

    if (/Departure at Origin/i.test(chunk)) {
      origin = name || null;
    } else if (/Arrival at Destination/i.test(chunk)) {
      destination = name || null;
      arrivalAt = date;
      arrivalEstimated = color === "blue";
    }
  }

  return { origin, destination, arrivalAt, arrivalEstimated };
}

/** Legs do bloco "Vessel Movement" (a última perna é o navio oceânico). */
function parseHmmVesselLegs(html: string): VesselLeg[] {
  const start = html.search(/>\s*Vessel Movement\s*</i);
  if (start < 0) return [];
  const tableStart = html.indexOf("<table", start);
  if (tableStart < 0) return [];
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd < 0) return [];
  const table = html.slice(tableStart, tableEnd);

  const legs: VesselLeg[] = [];
  for (const row of rowsOf(table)) {
    const cells = parseCells(row);
    if (cells.length < 6) continue;
    const vesselText = cells[0]?.text ?? "";
    const parsed = splitHmmVesselVoyage(vesselText) ?? {
      vessel: vesselText || null,
      voyage: null,
    };
    if (!parsed.vessel) continue;
    legs.push({
      vessel: parsed.vessel,
      voyage: parsed.voyage,
      loadingPort: cells[2]?.text || null,
      departure: cells[3]?.text || null,
      dischargingPort: cells[4]?.text || null,
      arrival: cells[5]?.text || null,
    });
  }
  return legs;
}

/** Containers do bloco "Container Information". */
function parseHmmContainers(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(
    /id="cntrId[^"]*"[^>]*>\s*([A-Z]{4}\d{6}\d)\s*</gi,
  )) {
    const number = coerceContainer(match[1]);
    if (number) found.add(number);
  }
  if (found.size === 0) {
    for (const match of html.matchAll(/cntrSelect\(([^)]*)\)/gi)) {
      const args = decodeEntities(match[1] ?? "").split(",");
      for (const arg of args) {
        const number = coerceContainer(arg.replace(/['"\s]/g, ""));
        if (number) found.add(number);
      }
    }
  }
  return Array.from(found);
}

/**
 * Converte o fragmento HTML do track & trace da HMM no snapshot interno.
 * Puro (sem rede) para permitir teste com fixture real.
 */
export function normalizeHmmResponse(
  html: string,
  options: { fallbackContainer?: string | null } = {},
): NormalizedTrackingSnapshot {
  if (!html || !html.trim()) {
    return {
      ...EMPTY_SNAPSHOT,
      status: "error",
      notes: "Resposta vazia da HMM",
    };
  }

  const route = parseHmmRoute(html);
  const containers = parseHmmContainers(html);
  const fallbackContainer = coerceContainer(options.fallbackContainer);
  const containerNumbers = Array.from(
    new Set([...containers, ...(fallbackContainer ? [fallbackContainer] : [])]),
  );
  const singleContainer =
    containerNumbers.length === 1 ? (containerNumbers[0] ?? null) : null;
  const defaultContainer = fallbackContainer ?? singleContainer;

  const events: NormalizedTrackingEvent[] = [];
  for (const row of html.matchAll(
    /<tr class="clsMoves[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const cells = parseCells(row[1] ?? "");
    if (cells.length < 4) continue;

    const dateCell = cells[0];
    const timeCell = cells[1];
    const locationCell = cells[2];
    const descriptionCell = cells[3];
    const modeCell = cells[4];

    const description = descriptionCell?.text?.trim() ?? "";
    if (!description) continue;

    const eventAt = parseTrackingDate(
      [dateCell?.text, timeCell?.text].filter(Boolean).join(" "),
    );
    if (!eventAt) continue;

    const modeVessel = splitHmmVesselVoyage(modeCell?.text);
    const estimated = (dateCell?.classes ?? []).includes("blue");
    let status = hmmEventStatus(description);
    // Evento azul é previsão: chegada/descarga futura não é fato consumado.
    if (
      estimated &&
      (status === "arrived" ||
        status === "discharged" ||
        status === "delivered" ||
        status === "empty_returned")
    ) {
      status = "in_transit";
    }

    events.push({
      eventAt,
      status,
      location: locationCell?.text?.trim() || null,
      description,
      containerNumber: defaultContainer,
      vessel: modeVessel?.vessel ?? null,
      voyage: modeVessel?.voyage ?? null,
      fingerprint: trackingEventFingerprint([
        defaultContainer,
        eventAt,
        description.toLowerCase().replace(/\s+/g, " "),
      ]),
    });
  }

  events.sort((a, b) => b.eventAt.localeCompare(a.eventAt));

  const legs = parseHmmVesselLegs(html);
  const destinationKey = normalizePortName(route.destination);
  const oceanLeg =
    [...legs]
      .reverse()
      .find(
        (leg) =>
          destinationKey.length > 0 &&
          normalizePortName(leg.dischargingPort) === destinationKey,
      ) ??
    legs.at(-1) ??
    null;
  const arrivalDate = parseTrackingDate(route.arrivalAt);

  if (events.length === 0) {
    // Container listado sem histórico: embarque existe, mas ainda sem evento.
    if (containerNumbers.length > 0) {
      return {
        found: true,
        status: "pending",
        vessel: oceanLeg?.vessel ?? null,
        voyage: oceanLeg?.voyage ?? null,
        eta: arrivalDate ? arrivalDate.slice(0, 10) : null,
        containers: containerNumbers,
        events: [],
        notes: null,
      };
    }

    const message = html.match(/<div class="tab-title">([\s\S]*?)<\/div>/i);
    const note = message ? textOf(message[1] ?? "") : "";
    return {
      ...EMPTY_SNAPSHOT,
      containers: [],
      notes: note ? note.slice(0, 300) : null,
    };
  }

  const latestWithVessel = events.find((event) => event.vessel);
  const vessel = oceanLeg?.vessel ?? latestWithVessel?.vessel ?? null;
  const voyage = oceanLeg?.voyage ?? latestWithVessel?.voyage ?? null;

  const latest = events[0];
  let status: TrackingStatus = latest?.status ?? "in_transit";
  if (
    route.arrivalEstimated &&
    (status === "arrived" || status === "discharged")
  ) {
    status = "in_transit";
  }

  return {
    found: true,
    status,
    vessel,
    voyage,
    eta: arrivalDate ? arrivalDate.slice(0, 10) : null,
    containers: containerNumbers,
    events,
    notes: null,
  };
}

let session: HmmSession | null = null;

async function createSession(): Promise<HmmSession> {
  const response = await fetch(PAGE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HMM respondeu ${response.status} na página de rastreio`);
  }

  const html = await response.text();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const csrf = html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1]?.trim() ?? "";

  if (!cookie || !csrf) {
    throw new Error("HMM não retornou cookies/CSRF da página de rastreio");
  }

  session = { cookie, csrf, expiresAt: Date.now() + 10 * 60_000 };
  return session;
}

async function getSession(force = false): Promise<HmmSession> {
  if (!force && session && session.expiresAt > Date.now()) return session;
  return createSession();
}

function toHmmQueryType(queryType: TrackingQueryType): HmmQueryType {
  if (queryType === "container") return "cntr";
  if (queryType === "booking") return "bkg";
  return "bl";
}

function requestBody(type: HmmQueryType, value: string) {
  return {
    type,
    listBl: type === "bl" ? [value] : [],
    listCntr: type === "cntr" ? [value] : [],
    listBkg: type === "bkg" ? [value] : [],
    listPo: [],
  };
}

/** Consulta o track & trace da HMM (0 créditos de Firecrawl). */
export async function fetchHmmTracking(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): Promise<HmmTrackingResult> {
  const value = normalizeTrackingNumber(params.queryValue);
  if (!value) {
    return {
      ok: false,
      errorCode: "hmm_invalid_query",
      errorMessage: "Número de BL/container vazio",
      httpStatus: null,
    };
  }

  const type = toHmmQueryType(params.queryType);
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let current: HmmSession;
    try {
      current = await getSession(attempt > 0);
    } catch (error) {
      return {
        ok: false,
        errorCode: "hmm_session_error",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Falha ao abrir sessão na HMM",
        httpStatus: null,
      };
    }

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json; charset=UTF-8",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
          Origin: "https://www.hmm21.com",
          Referer: PAGE_URL,
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-TOKEN": current.csrf,
          Cookie: current.cookie,
        },
        body: JSON.stringify(requestBody(type, value)),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return {
        ok: false,
        errorCode: "hmm_network_error",
        errorMessage: `Falha de rede ao consultar a HMM: ${
          error instanceof Error ? error.message : String(error)
        }`,
        httpStatus: null,
      };
    }

    lastStatus = response.status;

    if (response.status === 401 || response.status === 403) {
      // Sessão/CSRF expirado: descarta o cache e tenta uma vez com sessão nova.
      session = null;
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: `hmm_http_${response.status}`,
        errorMessage: `HMM respondeu ${response.status}`,
        httpStatus: response.status,
      };
    }

    const html = await response.text().catch(() => null);
    if (html === null) {
      return {
        ok: false,
        errorCode: "hmm_invalid_response",
        errorMessage: "HMM não retornou o HTML do rastreio",
        httpStatus: response.status,
      };
    }

    return {
      ok: true,
      snapshot: normalizeHmmResponse(html, {
        fallbackContainer: params.queryType === "container" ? value : null,
      }),
      httpStatus: response.status,
    };
  }

  return {
    ok: false,
    errorCode: `hmm_blocked_${lastStatus ?? 403}`,
    errorMessage: "HMM recusou a sessão de rastreio (CSRF/proteção anti-bot)",
    httpStatus: lastStatus,
  };
}
