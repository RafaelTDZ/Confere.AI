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

const PAGE_URL = "https://www.msc.com/en/track-a-shipment";
const API_URL = "https://www.msc.com/api/feature/tools/TrackingInfo";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const mscEventSchema = z.object({
  Order: z.number().nullish(),
  Date: z.string(),
  Location: z.string().nullish(),
  Description: z.string(),
  Detail: z.array(z.string()).nullish(),
});

const mscContainerSchema = z.object({
  ContainerNumber: z.string(),
  ContainerType: z.string().nullish(),
  PodEtaDate: z.string().nullish(),
  LatestMove: z.string().nullish(),
  Delivered: z.boolean().nullish(),
  Events: z.array(mscEventSchema).default([]),
});

const mscBlSchema = z.object({
  BillOfLadingNumber: z.string(),
  GeneralTrackingInfo: z
    .object({
      ShippedFrom: z.string().nullish(),
      ShippedTo: z.string().nullish(),
      PortOfLoad: z.string().nullish(),
      PortOfDischarge: z.string().nullish(),
    })
    .nullish(),
  ContainersInfo: z.array(mscContainerSchema).default([]),
  Delivered: z.boolean().nullish(),
});

const mscResponseSchema = z.object({
  IsSuccess: z.boolean(),
  // Em "não encontrado" a MSC devolve Data como string com a mensagem.
  Data: z
    .union([
      z.object({
        TrackingType: z.string().nullish(),
        BillOfLadings: z.array(mscBlSchema).default([]),
      }),
      z.string(),
    ])
    .nullish(),
});

export type MscTrackingResult =
  | { ok: true; snapshot: NormalizedTrackingSnapshot; httpStatus: number }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      httpStatus: number | null;
    };

/** Traduz as descrições da MSC para o status canônico. */
export function mscEventStatus(description: string): TrackingStatus {
  const text = description.toLowerCase();
  if (/delivered/.test(text) && !/estimated/.test(text)) return "delivered";
  if (/empty/.test(text) && /return/.test(text)) return "empty_returned";
  if (/transshipment/.test(text)) return "transshipment";
  if (/empty to shipper|received at cy/.test(text)) return "pending";
  if (/estimated time of arrival/.test(text)) return "in_transit";
  return inferTrackingStatus(description) ?? "in_transit";
}

function isoDate(value: string | null | undefined): string | null {
  const parsed = parseTrackingDate(value ?? null);
  return parsed ? parsed.slice(0, 10) : null;
}

function splitIso(value: string): { date: string; time: string } | null {
  const parsed = parseTrackingDate(value);
  if (!parsed) return null;
  return { date: parsed.slice(0, 10), time: parsed };
}

/**
 * Converte o JSON da MSC no snapshot interno. Puro (sem fetch) para permitir
 * teste com fixture real.
 */
export function normalizeMscResponse(
  raw: unknown,
  fallbackContainer: string | null,
): NormalizedTrackingSnapshot {
  const parsed = mscResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      found: false,
      status: "error",
      vessel: null,
      voyage: null,
      eta: null,
      containers: [],
      events: [],
      notes: "Resposta da MSC fora do formato esperado",
    };
  }

  const data = parsed.data;
  const dataObject = typeof data.Data === "object" ? data.Data : null;
  const containers = (dataObject?.BillOfLadings ?? []).flatMap(
    (bl) => bl.ContainersInfo,
  );

  if (!data.IsSuccess || containers.length === 0) {
    return {
      found: false,
      status: "not_found",
      vessel: null,
      voyage: null,
      eta: null,
      containers: [],
      events: [],
      notes:
        typeof data.Data === "string" ? data.Data.slice(0, 300) : null,
    };
  }

  const events: NormalizedTrackingEvent[] = [];
  const containerNumbers: string[] = [];
  let eta: string | null = null;
  let oceanVessel: string | null = null;
  let oceanVoyage: string | null = null;
  let delivered = false;

  for (const container of containers) {
    const number =
      normalizeTrackingNumber(container.ContainerNumber) ??
      normalizeTrackingNumber(fallbackContainer);
    if (number) containerNumbers.push(number);
    if (container.Delivered) delivered = true;
    eta ??= isoDate(container.PodEtaDate);

    for (const event of container.Events) {
      const moment = splitIso(event.Date);
      if (!moment) continue;

      const detailVessel = event.Detail?.[0]?.trim();
      const detailVoyage = event.Detail?.[1]?.trim();
      const validVessel =
        detailVessel && !/^(laden|empty)$/i.test(detailVessel)
          ? detailVessel
          : null;
      const validVoyage =
        detailVoyage && !/^(laden|empty)$/i.test(detailVoyage)
          ? detailVoyage
          : null;

      if (
        !oceanVessel &&
        validVessel &&
        /loaded on vessel/i.test(event.Description)
      ) {
        oceanVessel = validVessel;
        oceanVoyage = validVoyage;
      }

      events.push({
        eventAt: moment.time,
        status: mscEventStatus(event.Description),
        location: event.Location?.trim() || null,
        description: event.Description.trim(),
        containerNumber: number,
        vessel: validVessel,
        voyage: validVoyage,
        fingerprint: trackingEventFingerprint([
          number,
          moment.time,
          event.Description.toLowerCase().replace(/\s+/g, " "),
        ]),
      });
    }
  }

  events.sort((a, b) => b.eventAt.localeCompare(a.eventAt));

  const latest = events[0];
  const status: TrackingStatus = delivered
    ? "delivered"
    : latest?.status ?? "pending";

  if (!eta) {
    const etaEvent = events.find((event) =>
      /estimated time of arrival/i.test(event.description),
    );
    eta = etaEvent ? etaEvent.eventAt.slice(0, 10) : null;
  }

  // Sem evento de "loaded", usa o navio do evento mais recente.
  if (!oceanVessel) {
    const withVessel = events.find((event) => event.vessel);
    oceanVessel = withVessel?.vessel ?? null;
    oceanVoyage = withVessel?.voyage ?? null;
  }

  return {
    found: true,
    status,
    vessel: oceanVessel,
    voyage: oceanVoyage,
    eta,
    containers: Array.from(new Set(containerNumbers)),
    events,
    notes: null,
  };
}

let session: { cookie: string; expiresAt: number } | null = null;

async function getSessionCookie(): Promise<string> {
  if (session && session.expiresAt > Date.now()) return session.cookie;

  const response = await fetch(PAGE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`MSC respondeu ${response.status} na página de rastreio`);
  }

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  if (!cookie) throw new Error("MSC não retornou cookies de sessão");

  session = { cookie, expiresAt: Date.now() + 10 * 60_000 };
  return cookie;
}

/** Consulta a API interna da MSC (sem créditos de Firecrawl). */
export async function fetchMscTracking(params: {
  queryType: TrackingQueryType;
  queryValue: string;
}): Promise<MscTrackingResult> {
  let cookie: string;
  try {
    cookie = await getSessionCookie();
  } catch (error) {
    return {
      ok: false,
      errorCode: "msc_session_error",
      errorMessage:
        error instanceof Error ? error.message : "Falha ao abrir sessão na MSC",
      httpStatus: null,
    };
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
        "Content-Type": "application/json",
        Origin: "https://www.msc.com",
        Referer: PAGE_URL,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookie,
      },
      body: JSON.stringify({
        trackingNumber: params.queryValue,
        trackingMode: params.queryType === "booking" ? "1" : "0",
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return {
      ok: false,
      errorCode: "msc_network_error",
      errorMessage: `Falha de rede ao consultar a MSC: ${
        error instanceof Error ? error.message : String(error)
      }`,
      httpStatus: null,
    };
  }

  if (!response.ok) {
    // Sessão expirada: descarta o cache para a próxima tentativa.
    if (response.status === 403 || response.status === 401) session = null;
    return {
      ok: false,
      errorCode: `msc_http_${response.status}`,
      errorMessage: `MSC respondeu ${response.status}`,
      httpStatus: response.status,
    };
  }

  const json = await response.json().catch(() => null);
  return {
    ok: true,
    snapshot: normalizeMscResponse(json, params.queryValue),
    httpStatus: response.status,
  };
}
