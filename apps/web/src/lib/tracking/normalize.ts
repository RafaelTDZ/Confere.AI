import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  TrackingStatus,
  TrackingVesselMismatch,
} from "@/lib/tracking/shared";
import {
  isValidContainerNumber,
  normalizeTrackingNumber,
} from "@/lib/tracking/validate";

const firecrawlEventSchema = z.object({
  date: z.string(),
  location: z.string().nullish(),
  description: z.string(),
});

const firecrawlContainerSchema = z.object({
  number: z.string(),
  status: z.string().nullish(),
  events: z.array(firecrawlEventSchema).default([]),
});

const firecrawlTrackingSchema = z.object({
  found: z.boolean().default(false),
  carrier: z.string().nullish(),
  vessel: z.string().nullish(),
  voyage: z.string().nullish(),
  eta: z.string().nullish(),
  pol: z.string().nullish(),
  pod: z.string().nullish(),
  containers: z.array(firecrawlContainerSchema).default([]),
  notes: z.string().nullish(),
});

export type NormalizedTrackingEvent = {
  eventAt: string;
  status: TrackingStatus;
  location: string | null;
  description: string;
  containerNumber: string | null;
  vessel: string | null;
  voyage: string | null;
  fingerprint: string;
};

export type NormalizedTrackingSnapshot = {
  found: boolean;
  status: TrackingStatus;
  vessel: string | null;
  voyage: string | null;
  eta: string | null;
  containers: string[];
  events: NormalizedTrackingEvent[];
  notes: string | null;
  /**
   * Navio do portal difere do BL. Não invalida o snapshot (rollover/transbordo
   * é comum): só sinaliza a divergência para o usuário.
   */
  vesselMismatch?: TrackingVesselMismatch | null;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Converte datas de rastreio (ISO, DD/MM/AAAA, "12 Jan 2026", "Jan 12, 2026")
 * para ISO 8601. Retorna null quando não é possível interpretar.
 */
export function parseTrackingDate(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const iso = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (iso) {
    const [, year, month, day, hour, minute, second] = iso;
    const date = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour ?? 0),
        Number(minute ?? 0),
        Number(second ?? 0),
      ),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const numeric = raw.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/,
  );
  if (numeric) {
    const day = numeric[1] ?? "";
    const month = numeric[2] ?? "";
    const yearRaw = numeric[3] ?? "";
    const hour = numeric[4];
    const minute = numeric[5];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    const date = new Date(
      Date.UTC(
        year,
        Number(month) - 1,
        Number(day),
        Number(hour ?? 0),
        Number(minute ?? 0),
      ),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const dayMonthName = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{2,4})/);
  if (dayMonthName) {
    const day = dayMonthName[1] ?? "";
    const monthName = dayMonthName[2] ?? "";
    const yearRaw = dayMonthName[3] ?? "";
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
      return `${year}-${pad(month)}-${pad(Number(day))}T00:00:00.000Z`;
    }
  }

  // "Thursday, 01-OCT-2026 08:00 AM" / "Mon 02-NOV-2026 01:00 PM"
  const weekdayDayMonth = raw.match(
    /^(?:[A-Za-z]+,\s*|[A-Za-z]+\s+)?(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i,
  );
  if (weekdayDayMonth) {
    const day = weekdayDayMonth[1] ?? "";
    const monthName = weekdayDayMonth[2] ?? "";
    const year = weekdayDayMonth[3] ?? "";
    const hourRaw = weekdayDayMonth[4];
    const minute = weekdayDayMonth[5];
    const meridiem = weekdayDayMonth[6]?.toUpperCase();
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      let hour = Number(hourRaw ?? 0);
      if (meridiem === "PM" && hour < 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      return `${year}-${pad(month)}-${pad(Number(day))}T${pad(hour)}:${minute ?? "00"}:00.000Z`;
    }
  }

  const monthNameDay = raw.match(
    /^([A-Za-z]{3,4})[-/ ]+(\d{1,2}),?[-/ ]+(\d{4})/,
  );
  if (monthNameDay) {
    const monthName = monthNameDay[1] ?? "";
    const day = monthNameDay[2] ?? "";
    const year = monthNameDay[3] ?? "";
    const month = MONTHS[monthName.toLowerCase()];
    if (month) {
      return `${year}-${pad(month)}-${pad(Number(day))}T00:00:00.000Z`;
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const parsed = parseTrackingDate(value);
  return parsed ? parsed.slice(0, 10) : null;
}

type StatusRule = { status: TrackingStatus; patterns: RegExp[] };

const STATUS_RULES: StatusRule[] = [
  {
    status: "empty_returned",
    patterns: [
      /empty\s*return/i,
      /return(ed)?\s*empty/i,
      /devolu[cç][aã]o\s*de\s*vazio/i,
      /vazio\s*devolvido/i,
    ],
  },
  {
    status: "delivered",
    patterns: [/delivered/i, /entregue/i, /final\s*delivery/i, /pod\s*confirmed/i],
  },
  {
    // "Planned Vessel Arrival" não é chegada: o navio ainda está em trânsito.
    status: "in_transit",
    patterns: [
      /planned/i,
      /estimated/i,
      /previst[oa]/i,
      /programad[oa]/i,
    ],
  },
  {
    status: "discharged",
    patterns: [/discharg/i, /unload/i, /descarreg/i, /descarga/i],
  },
  {
    status: "arrived",
    patterns: [/arriv/i, /at\s*berth/i, /chegada/i, /atracad/i],
  },
  {
    status: "transshipment",
    patterns: [/transship/i, /transbordo/i, /trans-?shipment/i],
  },
  {
    status: "in_transit",
    patterns: [
      /loaded/i,
      /on\s*board/i,
      /depart/i,
      /sailed/i,
      /gate\s*out/i,
      /embarcad/i,
      /em\s*tr[aâ]nsito/i,
      /in\s*transit/i,
    ],
  },
];

/** Converte texto livre (PT/EN) no status canônico do rastreio. */
export function inferTrackingStatus(value: string | null | undefined): TrackingStatus | null {
  const text = value?.trim();
  if (!text) return null;
  for (const rule of STATUS_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.status;
  }
  return null;
}

function fingerprint(parts: Array<string | null>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex")
    .slice(0, 40);
}

/**
 * Aceita "MMAU142149940" (container + tipo 40) e devolve o ISO válido
 * "MMAU1421499". Retorna null quando não há prefixo válido.
 */
function coerceContainer(value: string | null | undefined): string | null {
  const normalized = normalizeTrackingNumber(value);
  if (!normalized) return null;
  if (isValidContainerNumber(normalized)) return normalized;
  const prefix = normalized.slice(0, 11);
  return isValidContainerNumber(prefix) ? prefix : null;
}

/** Fingerprint estável de um evento (usado na deduplicação do banco). */
export function trackingEventFingerprint(
  parts: Array<string | null>,
): string {
  return fingerprint(parts);
}

/** Compara nomes de navio ignorando pontuação e caixa. */
function sameVessel(a: string, b: string): boolean {
  const first = a.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const second = b.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!first || !second) return true;
  return first === second || first.includes(second) || second.includes(first);
}

/** Normaliza o JSON devolvido pelo Firecrawl em um snapshot do domínio. */
export function normalizeFirecrawlResult(
  raw: unknown,
  fallbackContainer: string | null,
  expected?: { vessel?: string | null } | null,
): NormalizedTrackingSnapshot {
  const parsed = firecrawlTrackingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      found: false,
      status: "error",
      vessel: null,
      voyage: null,
      eta: null,
      containers: [],
      events: [],
      notes: "Resposta do Firecrawl fora do formato esperado",
      vesselMismatch: null,
    };
  }

  const data = parsed.data;

  // Navio diferente do BL **não** invalida o resultado: a carga pode ter sido
  // remanejada (rollover/transbordo) e o portal é a fonte mais recente. O
  // snapshot é aceito com o navio/viagem do portal e a divergência sinalizada.
  const expectedVessel = expected?.vessel?.trim();
  const foundVessel = data.vessel?.trim();
  const vesselMismatch: TrackingVesselMismatch | null =
    expectedVessel && foundVessel && !sameVessel(foundVessel, expectedVessel)
      ? { expected: expectedVessel, found: foundVessel }
      : null;

  // Container divergente continua sendo rejeitado: é o sinal mais forte de
  // resultado de outro embarque (placeholder do portal).
  const expectedContainer = coerceContainer(fallbackContainer);
  const reportedContainers = data.containers
    .map((container) => coerceContainer(container.number))
    .filter((value): value is string => Boolean(value));
  if (
    expectedContainer &&
    reportedContainers.length > 0 &&
    !reportedContainers.includes(expectedContainer)
  ) {
    return {
      found: false,
      status: "not_found",
      vessel: null,
      voyage: null,
      eta: null,
      containers: [],
      events: [],
      notes: `Resultado de outro container (${reportedContainers.join(", ")}); esperado ${expectedContainer}`,
      vesselMismatch: null,
    };
  }
  const events: NormalizedTrackingEvent[] = [];
  const containersSeen = new Set<string>();

  for (const container of data.containers) {
    const number =
      coerceContainer(container.number) ?? coerceContainer(fallbackContainer);
    if (number) containersSeen.add(number);
    const containerStatus = container.status ?? null;

    for (const event of container.events) {
      const eventAt = parseTrackingDate(event.date);
      if (!eventAt) continue;
      const description = event.description.trim();
      if (!description) continue;

      const status =
        inferTrackingStatus(containerStatus) ??
        inferTrackingStatus(description) ??
        "in_transit";

      events.push({
        eventAt,
        status,
        location: event.location?.trim() || null,
        description,
        containerNumber: number,
        vessel: data.vessel?.trim() || null,
        voyage: data.voyage?.trim() || null,
        fingerprint: fingerprint([
          number,
          eventAt,
          description.toLowerCase().replace(/\s+/g, " "),
        ]),
      });
    }
  }

  // Mais recente primeiro; dedupe por fingerprint preservando a primeira ocorrência.
  events.sort((a, b) => b.eventAt.localeCompare(a.eventAt));
  const unique: NormalizedTrackingEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.fingerprint)) continue;
    seen.add(event.fingerprint);
    unique.push(event);
  }

  const containers = Array.from(containersSeen);
  const latest = unique[0];
  // Um "not found" residual na página não pode apagar eventos já extraídos.
  let status: TrackingStatus = latest
    ? latest.status
    : data.found || data.containers.length > 0
      ? inferTrackingStatus(data.containers[0]?.status ?? null) ?? "pending"
      : "not_found";

  // Chegada/descarga com data futura é previsão, não evento concluído.
  if (
    latest &&
    (status === "arrived" || status === "discharged") &&
    Date.parse(latest.eventAt) > Date.now()
  ) {
    status = "in_transit";
  }

  return {
    found: data.found || unique.length > 0,
    status,
    vessel: foundVessel || null,
    voyage: data.voyage?.trim() || null,
    eta: normalizeDateOnly(data.eta) ?? deriveEtaFromEvents(unique),
    containers,
    events: unique,
    notes:
      [
        data.notes?.trim() || null,
        vesselMismatch
          ? `Navio no portal diferente do BL: ${vesselMismatch.found} × ${vesselMismatch.expected}`
          : null,
      ]
        .filter((note): note is string => Boolean(note))
        .join(" · ") || null,
    vesselMismatch,
  };
}

/** Usa a chegada planejada como ETA quando o topo da página não informa. */
function deriveEtaFromEvents(
  events: NormalizedTrackingEvent[],
): string | null {
  const planned = events.find(
    (event) =>
      /planned|estimated|previst[oa]|programad[oa]/i.test(event.description) &&
      /arriv|chegada/i.test(event.description),
  );
  return planned ? planned.eventAt.slice(0, 10) : null;
}
