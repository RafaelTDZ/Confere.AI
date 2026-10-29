import type { TrackingQueryType } from "@/lib/tracking/shared";
import { normalizeTrackingNumber } from "@/lib/tracking/validate";

export type CarrierCode =
  | "maersk"
  | "msc"
  | "cma"
  | "hapag"
  | "cosco"
  | "evergreen"
  | "oocl"
  | "hmm"
  | "one"
  | "unknown";

export type CarrierDefinition = {
  code: CarrierCode;
  label: string;
  /** Trechos usados para reconhecer o armador no texto extraído do BL. */
  aliases: string[];
  /** Consultas aceitas pelo portal público. */
  accepts: TrackingQueryType[];
  /** Estratégia inicial (pode ser sobrescrita por env no servidor). */
  strategy: "http" | "firecrawl" | "link";
};

export const CARRIERS: Record<CarrierCode, CarrierDefinition> = {
  maersk: {
    code: "maersk",
    label: "Maersk",
    aliases: ["maersk", "maeu", "maersk line", "sealand"],
    accepts: ["bl", "container"],
    strategy: "firecrawl",
  },
  msc: {
    code: "msc",
    label: "MSC",
    aliases: ["msc", "mscu", "mediterranean shipping"],
    accepts: ["bl", "container"],
    strategy: "http",
  },
  cma: {
    code: "cma",
    label: "CMA CGM",
    aliases: ["cma cgm", "cmacgm", "cmdu", "cma", "anl"],
    accepts: ["bl", "container", "booking"],
    strategy: "firecrawl",
  },
  hapag: {
    code: "hapag",
    label: "Hapag-Lloyd",
    aliases: ["hapag", "hapag lloyd", "hapag-lloyd", "hlcu", "hlag", "hlbu"],
    accepts: ["bl", "container"],
    strategy: "firecrawl",
  },
  cosco: {
    code: "cosco",
    label: "COSCO",
    aliases: ["cosco", "cosu", "cosco shipping", "coscon"],
    accepts: ["bl", "container"],
    strategy: "firecrawl",
  },
  evergreen: {
    code: "evergreen",
    label: "Evergreen",
    aliases: ["evergreen", "evergreen line", "evergreen marine", "eglv", "emc"],
    accepts: ["bl", "container"],
    strategy: "firecrawl",
  },
  oocl: {
    code: "oocl",
    label: "OOCL",
    aliases: [
      "oocl",
      "oolu",
      "orient overseas",
      "orient overseas container line",
    ],
    accepts: ["bl", "container", "booking"],
    // Portal protegido por captcha da CargoSmart: link + evento manual.
    strategy: "link",
  },
  hmm: {
    code: "hmm",
    label: "HMM",
    aliases: ["hmm", "hdmu", "hyundai", "hyundai merchant marine"],
    accepts: ["bl", "container", "booking"],
    strategy: "http",
  },
  one: {
    code: "one",
    label: "ONE",
    aliases: ["one", "one line", "ocean network express", "oney", "oneys"],
    accepts: ["bl", "container", "booking"],
    strategy: "http",
  },
  unknown: {
    code: "unknown",
    label: "Armador não identificado",
    aliases: [],
    accepts: ["bl", "container"],
    strategy: "firecrawl",
  },
};

const SUPPORTED_CARRIERS: CarrierCode[] = [
  "maersk",
  "msc",
  "cma",
  "hapag",
  "cosco",
  "evergreen",
  "oocl",
  "hmm",
  "one",
];

/** Rótulo de exibição; código desconhecido cai em `CARRIERS.unknown`. */
export function carrierLabelFor(code: string | null | undefined): string {
  if (code && Object.prototype.hasOwnProperty.call(CARRIERS, code)) {
    return CARRIERS[code as CarrierCode].label;
  }
  return CARRIERS.unknown.label;
}

/**
 * O portal aceita consulta por container? Quando não aceita, o BL de casa não
 * tem substituto automático e a importação fica em rastreio manual (`link`).
 */
export function carrierSupportsContainer(
  code: CarrierCode | null | undefined,
): boolean {
  return CARRIERS[code ?? "unknown"].accepts.includes("container");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Descobre o armador a partir do texto livre extraído do BL. */
export function detectCarrier(value: string | null | undefined): CarrierCode {
  const text = normalizeText(value ?? "");
  if (!text) return "unknown";

  // Aliases maiores primeiro evitam "cma" casar dentro de "cma cgm" por acaso.
  const candidates: Array<{ code: CarrierCode; alias: string }> = [];
  for (const code of SUPPORTED_CARRIERS) {
    for (const alias of CARRIERS[code].aliases) {
      candidates.push({ code, alias: normalizeText(alias) });
    }
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);

  for (const { code, alias } of candidates) {
    if (alias.length === 0) continue;
    const pattern = new RegExp(`(^| )${escapeRegex(alias)}( |$)`);
    if (pattern.test(text)) return code;
  }
  return "unknown";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Prefixos de containers próprios da Hapag-Lloyd (HLBU/HLXU/HLKU). */
const HAPAG_CONTAINER_RE = /^HL[BXK]U\d{7}$/;

/**
 * Detecta o armador pelo texto do BL, pelo navio e, quando o BL é de
 * forwarder (carrier desconhecido), pelos containers HLBU/HLXU/HLKU.
 */
export function inferCarrier(
  carrierText: string | null | undefined,
  containers: ReadonlyArray<string | null | undefined> = [],
  vessel: string | null | undefined = null,
): CarrierCode {
  const detected = detectCarrier(carrierText);
  if (detected !== "unknown") return detected;

  const vesselText = normalizeText(vessel ?? "");
  if (vesselText) {
    const vesselPatterns: Array<[CarrierCode, RegExp]> = [
      ["cma", /\bcma cgm\b/],
      ["msc", /\bmsc\b/],
      ["maersk", /\bmaersk\b/],
      ["evergreen", /\bevergreen\b/],
      ["cosco", /\bcosco\b/],
      ["oocl", /\boocl\b/],
      ["hapag", /\bhapag\b/],
      ["hmm", /\bhmm\b/],
      ["one", /\bone\b/],
    ];
    for (const [code, pattern] of vesselPatterns) {
      if (pattern.test(vesselText)) return code;
    }
  }

  for (const value of containers) {
    const normalized = normalizeTrackingNumber(value);
    if (normalized && HAPAG_CONTAINER_RE.test(normalized)) return "hapag";
  }
  return "unknown";
}

/** Link público do armador (fallback e botão "Abrir no armador"). */
export function buildCarrierDeepLink(params: {
  carrier: CarrierCode;
  queryType: TrackingQueryType;
  queryValue: string;
}): string | null {
  const value = encodeURIComponent(params.queryValue);
  const type = params.queryType;

  switch (params.carrier) {
    case "maersk":
      return `https://www.maersk.com/tracking/${value}`;
    case "hapag":
      return type === "container"
        ? "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html"
        : "https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html";
    case "msc":
      return `https://www.msc.com/en/track-a-shipment?trackingNumber=${value}`;
    case "cma": {
      const searchBy =
        type === "bl" ? "BL" : type === "booking" ? "BOOKING" : "CONTAINER";
      return `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=${searchBy}&Reference=${value}`;
    }
    case "cosco": {
      const trackingType =
        type === "bl"
          ? "blNumber"
          : type === "container"
            ? "containerNumber"
            : "bookingNumber";
      return `https://elines.coscoshipping.com/scct/public/ct/base?lang=en&trackingType=${trackingType}&number=${value}`;
    }
    case "evergreen":
      return "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do";
    case "oocl":
      return "https://www.oocl.com/eng/ourservices/eservices/cargotracking/pages/cargotracking.aspx";
    case "hmm":
      return "https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do";
    case "one": {
      const code = type === "container" ? "C" : "B";
      return `https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${value}&trakNoTpCdParam=${code}`;
    }
    default:
      return null;
  }
}
