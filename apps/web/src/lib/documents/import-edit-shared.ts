import type { BlExtraction } from "@/lib/ai/schemas";

/**
 * Campos de texto editáveis do BL extraído (string ou null). Campos
 * estruturados (`consigneeDetails`/`notifyPartyDetails`) ficam de fora: são
 * derivados e não aparecem no formulário.
 */
export const BL_EDITABLE_TEXT_FIELDS = [
  "number",
  "masterBlNumber",
  "carrier",
  "shipper",
  "consignee",
  "notifyParty",
  "polCity",
  "polCountry",
  "podCity",
  "podCountry",
  "vessel",
  "voyage",
  "descriptionOfGoods",
  "grossWeight",
  "volumes",
  "packages",
  "measurement",
  "freightValue",
  "freightCurrency",
  "freightTerms",
  "freeTime",
  "containerQuantity",
  "containerType",
  "onboardDate",
  "eta",
] as const satisfies readonly (keyof BlExtraction)[];

/** Campos de lista editáveis do BL (edição como texto separado por vírgula). */
export const BL_EDITABLE_LIST_FIELDS = [
  "ncm",
  "containerNumbers",
  "sealNumbers",
] as const satisfies readonly (keyof BlExtraction)[];

export type BlEditableTextField = (typeof BL_EDITABLE_TEXT_FIELDS)[number];
export type BlEditableListField = (typeof BL_EDITABLE_LIST_FIELDS)[number];

/** Campos do BL que são datas e seguem o padrão brasileiro (DD/MM/AAAA). */
export const BL_DATE_FIELDS = ["onboardDate", "eta"] as const;

const MONTHS: Record<string, string> = {
  JAN: "01",
  FEV: "02",
  FEB: "02",
  MAR: "03",
  ABR: "04",
  APR: "04",
  MAI: "05",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AGO: "08",
  AUG: "08",
  SET: "09",
  SEP: "09",
  OUT: "10",
  OCT: "10",
  NOV: "11",
  DEZ: "12",
  DEC: "12",
};

function pad2(value: string): string {
  return value.length === 1 ? `0${value}` : value;
}

function padYear(value: string): string {
  return value.length === 2 ? `20${value}` : value;
}

/**
 * Converte datas extraídas para o padrão brasileiro (DD/MM/AAAA). Entende
 * `2026-10-06`, `OCT/06/2026`, `06 OCT 2026`, `10.06.2026` e `6/10/26`.
 * Quando não reconhece o formato, devolve o valor original.
 */
export function formatDateBr(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";

  const upper = raw.toUpperCase();

  const monthFromName = upper.match(
    /\b(JAN|FEV|FEB|MAR|ABR|APR|MAI|MAY|JUN|JUL|AGO|AUG|SET|SEP|OUT|OCT|NOV|DEZ|DEC)[A-Z]*\b/,
  );
  const numbers = upper
    .replace(/[^0-9]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (monthFromName) {
    const monthKey = monthFromName[1];
    const month = monthKey ? MONTHS[monthKey] : undefined;
    const year = numbers.find((token) => token.length === 4) ?? numbers.at(-1);
    const day = numbers.find((token) => token !== year);
    if (month && day && year) {
      return `${pad2(day)}/${month}/${padYear(year)}`;
    }
    return raw;
  }

  const numeric = upper.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
  if (!numeric) return raw;

  const first = numeric[1];
  const second = numeric[2];
  const third = numeric[3];
  if (!first || !second || !third) return raw;
  if (first.length === 4) {
    return `${pad2(third)}/${pad2(second)}/${first}`;
  }
  return `${pad2(first)}/${pad2(second)}/${padYear(third)}`;
}

export type BlEditablePatch = Partial<
  Pick<BlExtraction, BlEditableTextField | BlEditableListField>
>;

export type ImportProductPatch = {
  code: string | null;
  ncm: string | null;
  description: string | null;
};

/**
 * Correções manuais sobre o que a IA extraiu. Os números da Invoice/BL vivem
 * nas colunas de `imports` e também são espelhados no payload da extração para
 * as duas leituras continuarem coerentes.
 */
export type ImportExtractionPatch = {
  invoiceNumber?: string | null;
  blNumber?: string | null;
  bl?: BlEditablePatch;
  products?: ImportProductPatch[];
};
