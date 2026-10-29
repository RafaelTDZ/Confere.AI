import "server-only";

import type { BlExtraction } from "@/lib/ai/schemas";
import { formatDateBr } from "@/lib/documents/import-edit-shared";
import {
  CARRIERS,
  inferCarrier,
  type CarrierCode,
} from "@/lib/tracking/carriers";
import { normalizeTrackingNumber } from "@/lib/tracking/validate";

/**
 * Normalização pós-extração do BL: números em pt-BR, datas DD/MM/AAAA,
 * quantidades inteiras, tipo de container e descrição sem boilerplate.
 */

const CARRIER_DISPLAY: Partial<Record<CarrierCode, string>> = {
  maersk: "MAERSK",
  msc: "MSC",
  cma: "CMA CGM",
  hapag: CARRIERS.hapag.label.toUpperCase(),
  cosco: "COSCO",
  evergreen: "EVERGREEN",
  oocl: "OOCL",
  hmm: "HMM",
  one: "ONE",
};

/** Emitentes que normalmente são forwarders, não o armador oceânico. */
const FORWARDER_RE =
  /\b(LX\s*PANTOS|YQN|DHL|KUEHNE|SCHENKER|PANALPINA|EXPEDITORS|CEVA|GEODIS|DSV|FEDEX|UPS|LOGISTICS)\b/i;

type ParsedDecimal = { value: number; decimals: number };

type DecimalOptions = {
  /** Trata um único separador seguido de 3 dígitos como milhar (valores de frete). */
  groupThousands?: boolean;
};

/** Converte "40,093.200", "136.000", "1.234,56" etc. em número + casas. */
export function parseDecimalBr(
  value: string | null | undefined,
  options?: DecimalOptions,
): ParsedDecimal | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const text = raw.replace(/[^\d.,-]/g, "");
  if (!text || !/\d/.test(text)) return null;

  const commaCount = (text.match(/,/g) ?? []).length;
  const dotCount = (text.match(/\./g) ?? []).length;

  let decimalSeparator: "," | "." | null = null;
  if (commaCount > 0 && dotCount > 0) {
    // O último separador é o decimal (1.234,56 ou 1,234.56).
    decimalSeparator =
      text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
  } else if (commaCount === 1 && dotCount === 0) {
    decimalSeparator = ",";
  } else if (dotCount === 1 && commaCount === 0) {
    decimalSeparator = ".";
  }
  // Múltiplos separadores iguais (1.234.567) ou nenhum: são milhares.

  // Valores inteiros grandes (frete) aparecem como "8,400" ou "8.400" nas duas
  // convenções; um único separador seguido de exatamente 3 dígitos é milhar.
  if (
    options?.groupThousands &&
    decimalSeparator &&
    commaCount + dotCount === 1
  ) {
    const tail = text.slice(text.lastIndexOf(decimalSeparator) + 1);
    if (/^\d{3}$/.test(tail)) decimalSeparator = null;
  }

  let normalized = text;
  if (decimalSeparator === ",") {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (decimalSeparator === ".") {
    normalized = text.replace(/,/g, "");
  } else {
    normalized = text.replace(/[.,]/g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  const decimals = decimalSeparator
    ? text.length -
      (decimalSeparator === "," ? text.lastIndexOf(",") : text.lastIndexOf(".")) -
      1
    : 0;

  return { value: parsed, decimals: Math.min(Math.max(decimals, 0), 6) };
}

/** Formata um número no padrão brasileiro, preservando as casas decimais. */
export function formatDecimalBr(
  value: string | null | undefined,
  options?: DecimalOptions,
): string | null {
  const parsed = parseDecimalBr(value, options);
  if (!parsed) return null;
  return parsed.value.toLocaleString("pt-BR", {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
  });
}

/** Quantidade inteira: "2.664" / "2,664" / " 2 " → "2664" / "2". */
export function normalizeIntegerBr(
  value: string | null | undefined,
): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return String(Number.parseInt(digits, 10));
}

/** Datas para DD/MM/AAAA, incluindo ISO com hora. */
export function normalizeDateBr(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const formatted = formatDateBr(raw).trim();
  return formatted.length > 0 ? formatted : null;
}

/** "2X40 HC" / "40hc" → "40 HC". */
export function normalizeContainerType(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const withoutQuantity = raw.replace(/^\d+\s*[xX]\s*/, "").trim();
  const normalized = withoutQuantity
    .toUpperCase()
    .replace(/['"]/g, "")
    .replace(/HIGH\s*CUBE/g, "HC")
    .replace(/^(\d{2})\s*(HC|GP|DRY|RF|OT|FR|HQ|NOR)\b/, "$1 $2")
    .replace(/^(\d{2})([A-Z]{2})$/, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

/** "21 days" / "21 DIAS" → "21 DIAS". */
function normalizeFreeTimeBr(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const match = raw.match(/^(\d+)\s*(?:DAYS?|DIAS?|DIA)?$/i);
  if (match?.[1]) return `${match[1]} DIAS`;
  return raw.toUpperCase();
}

/** Remove boilerplate do BL ("SHIPPER'S LOAD AND COUNT", "SAID TO CONTAIN"). */
export function normalizeDescription(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const cleaned = raw
    .toUpperCase()
    .replace(/SHIPPER['’]?S?\s+LOAD\s*(?:,|\/|AND)\s*COUNT/g, " ")
    .replace(/SAID\s+TO\s+CONTAIN/g, " ")
    .replace(/SEE\s+THE\s+ATTACHED\s+RIDER/g, " ")
    .replace(/SHIPPER['’]?S?\s+LOAD\s+AND\s+COUNT/g, " ")
    // Cauda de NCM/embalagem de madeira que o rider repete no fim da descrição.
    .replace(/\bNCM\s*(?:CODE)?\s*:?\s*[\d.\s]+/g, " ")
    .replace(/\bWOODEN\s+PACK(?:ING|AGE)\s*:?[\s\S]*$/g, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;/\-]+|[\s,;/\-]+$/g, "")
    .trim();

  return cleaned.length > 0 ? cleaned : raw.toUpperCase();
}

/**
 * Se o BL foi emitido por um forwarder, troca pelo armador oceânico
 * inferido do navio/containers (ex.: LX Pantos + CMA CGM KRYPTON → CMA CGM).
 */
export function normalizeCarrier(
  carrier: string | null | undefined,
  vessel: string | null | undefined,
  containers: string[],
): string | null {
  const raw = carrier?.trim() ?? "";
  const shouldInfer = !raw || FORWARDER_RE.test(raw);
  if (!shouldInfer) return raw.toUpperCase();

  const inferred = inferCarrier("", containers, vessel ?? null);
  const display = inferred === "unknown" ? null : CARRIER_DISPLAY[inferred];
  if (display) return display;

  return raw.length > 0 ? raw.toUpperCase() : null;
}

/** Aplica todas as normalizações no payload extraído do BL. */
export function normalizeBlExtraction(bl: BlExtraction): BlExtraction {
  return {
    ...bl,
    masterBlNumber: normalizeTrackingNumber(bl.masterBlNumber),
    carrier: normalizeCarrier(bl.carrier, bl.vessel, bl.containerNumbers),
    grossWeight: formatDecimalBr(bl.grossWeight, { groupThousands: true }),
    volumes: normalizeIntegerBr(bl.volumes),
    measurement: formatDecimalBr(bl.measurement),
    freightValue: formatDecimalBr(bl.freightValue, { groupThousands: true }),
    freeTime: normalizeFreeTimeBr(bl.freeTime),
    containerQuantity: normalizeIntegerBr(bl.containerQuantity),
    containerType: normalizeContainerType(bl.containerType),
    descriptionOfGoods: normalizeDescription(bl.descriptionOfGoods),
    onboardDate: normalizeDateBr(bl.onboardDate),
    eta: normalizeDateBr(bl.eta),
    containerNumbers: Array.from(
      new Set(
        bl.containerNumbers
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
      ),
    ),
  };
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

/**
 * Master BL (consolidação) no markdown do PDF. O rótulo pode vir como
 * `MASTER B/L`, `MASTER BILL OF LADING`, `OCEAN B/L` ou `MBL NO.`; o número
 * costuma ser `<4 letras><5+ alfanuméricos>` e precisa ter ao menos 4 dígitos
 * (evita capturar palavras como "MASTER" logo após o rótulo).
 */
export function masterBlFromText(text: string): string | null {
  const patterns = [
    /(?:MASTER|OCEAN)\s*(?:B\/?L|BILL\s+OF\s+LADING)[^\n]{0,40}?\b([A-Z]{4}[A-Z0-9]{5,})\b/i,
    /\bM\/?B\/?L(?:\s*(?:NO\.?|NUMBER|#))?\s*[:#]?\s*([A-Z]{4}[A-Z0-9]{5,})\b/i,
  ];

  for (const pattern of patterns) {
    const value = firstMatch(text, pattern);
    if (!value) continue;
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) return value.toUpperCase();
  }

  return null;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/**
 * Preenche campos que a IA deixou vazios usando o markdown do PDF (Firecrawl).
 * Não sobrescreve valores já extraídos — só completa null/[].
 */
export function applyMarkdownFallbacks(
  bl: BlExtraction,
  markdown: string,
): BlExtraction {
  const text = markdown.replace(/\r/g, "");
  if (!text.trim()) return bl;

  // O rótulo "master" às vezes aparece no próprio BL do documento; não vale
  // duplicar o número como se fosse a consolidação.
  const masterFromMarkdown = masterBlFromText(text);
  const masterBlNumber =
    masterFromMarkdown &&
    normalizeTrackingNumber(masterFromMarkdown) !==
      normalizeTrackingNumber(bl.number)
      ? masterFromMarkdown
      : null;
  const grossWeight = firstMatch(text, /\bKGS\s*([\d.,]+)/i);
  const measurement = firstMatch(text, /\bCBM(?:\(M3\))?\s*([\d.,]+)/i);
  const volumes = firstMatch(text, /([\d.,]+)\s*CARTONS?\b/i);
  const containerTypeParts = text.match(/(\d{2})\s*(HC|GP|DRY|RF|HQ)\b/i);
  const containerQuantity = firstMatch(
    text,
    /\b(\d+)\s*X\s*\d{2}\s*(?:HC|GP|DRY|RF|HQ)\b/i,
  );
  const oft = text.match(/\bOFT\s*:\s*([A-Z]{3})\s*([\d.,]+)/i);
  const freeTime = firstMatch(
    text,
    /\bFREE\s*TIME\s*:\s*(\d+)\s*(?:DAYS?|DIAS?)/i,
  );
  const onboardDate = firstMatch(
    text,
    /\bON\s*BOARD\s*DATE\s*([A-Z]{3}\/\d{2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i,
  );
  const description = firstMatch(
    text,
    // O rider pode separar o título do texto com uma linha de traços.
    /\bDESCRIPTION OF GOODS\s*\n(?:[-=_*]+\s*\n)*\s*([^\n]+)/i,
  );
  const containerNumbers = Array.from(
    new Set(text.match(/\b[A-Z]{4}\d{7}\b/g) ?? []),
  );
  const ncm = Array.from(
    new Set(
      [...text.matchAll(/\bNCM\s*(?:CODE)?\s*:?\s*([\d.]{4,})/gi)].map(
        (match) => match[1]?.trim(),
      ),
    ),
  ).filter((value): value is string => Boolean(value));

  return normalizeBlExtraction({
    ...bl,
    masterBlNumber: isBlank(bl.masterBlNumber)
      ? masterBlNumber
      : bl.masterBlNumber,
    grossWeight: isBlank(bl.grossWeight) ? grossWeight : bl.grossWeight,
    measurement: isBlank(bl.measurement) ? measurement : bl.measurement,
    volumes: isBlank(bl.volumes) ? volumes : bl.volumes,
    containerQuantity: isBlank(bl.containerQuantity)
      ? containerQuantity
      : bl.containerQuantity,
    containerType: isBlank(bl.containerType)
      ? containerTypeParts
        ? `${containerTypeParts[1]} ${containerTypeParts[2]}`
        : null
      : bl.containerType,
    freightValue: isBlank(bl.freightValue) ? (oft?.[2] ?? null) : bl.freightValue,
    freightCurrency: isBlank(bl.freightCurrency)
      ? (oft?.[1] ?? null)
      : bl.freightCurrency,
    freeTime: isBlank(bl.freeTime) ? freeTime : bl.freeTime,
    onboardDate: isBlank(bl.onboardDate) ? onboardDate : bl.onboardDate,
    descriptionOfGoods: isBlank(bl.descriptionOfGoods)
      ? description
      : bl.descriptionOfGoods,
    containerNumbers:
      bl.containerNumbers.length > 0
        ? bl.containerNumbers
        : containerNumbers,
    ncm: bl.ncm.length > 0 ? bl.ncm : ncm,
  });
}

