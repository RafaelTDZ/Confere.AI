import "server-only";

import type { DocumentType } from "@/lib/ai/schemas";

/**
 * Classificação sem IA a partir do markdown do Firecrawl (e do nome do arquivo).
 *
 * O objetivo é evitar uma chamada inteira ao modelo só para dizer "isto é um
 * BL": os cabeçalhos dos documentos de importação são literais e estáveis.
 * Quando não há marcador forte o suficiente devolvemos `null` e o pipeline cai
 * na classificação por IA (comportamento anterior).
 */

export type HeuristicClassification = {
  types: DocumentType[];
  /** Marcadores encontrados — vão para o log de IA. */
  matches: string[];
};

type Marker = {
  type: DocumentType;
  pattern: RegExp;
  label: string;
};

/**
 * Só marcadores fortes (título do documento). Evita falso positivo do tipo
 * "BL que cita INVOICE NO." — por isso não há padrão genérico de invoice aqui.
 */
const MARKERS: readonly Marker[] = [
  // Bill of Lading
  {
    type: "bill_of_lading",
    pattern: /\bbills?\s+of\s+lading\b/,
    label: "bill of lading",
  },
  {
    type: "bill_of_lading",
    pattern: /\bbl\s*(?:no\.?|number|#)\b/,
    label: "bl no",
  },
  {
    type: "bill_of_lading",
    pattern: /\bocean\s+bill\b/,
    label: "ocean bill",
  },
  {
    type: "bill_of_lading",
    pattern: /\bsea\s+waybill\b/,
    label: "sea waybill",
  },
  {
    type: "bill_of_lading",
    pattern: /\bconhecimento\s+de\s+embarque\b/,
    label: "conhecimento de embarque",
  },
  // Commercial Invoice
  {
    type: "invoice",
    pattern: /\bcommercial\s+invoice\b/,
    label: "commercial invoice",
  },
  {
    type: "invoice",
    pattern: /\bproforma\s+invoice\b/,
    label: "proforma invoice",
  },
  {
    type: "invoice",
    pattern: /\bfatura\s+comercial\b/,
    label: "fatura comercial",
  },
  // Packing List
  {
    type: "packing_list",
    pattern: /\bpacking[\s-]*list\b/,
    label: "packing list",
  },
  {
    type: "packing_list",
    pattern: /\bromaneio\b/,
    label: "romaneio",
  },
];

const DOCUMENT_TYPES: readonly DocumentType[] = [
  "invoice",
  "packing_list",
  "bill_of_lading",
];

/**
 * Marcador só vale no começo do documento ou como título de linha. Sem isso o
 * clausulado do BL ("...production of the commercial invoice for the Goods")
 * viraria uma Invoice.
 */
const EARLY_WINDOW = 1_200;

function normalize(text: string): string {
  // Preserva quebras de linha: a checagem de título depende delas.
  return text.replace(/[ \t]+/g, " ").toLowerCase();
}

function isHeadingLike(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const prefix = text.slice(lineStart, index);
  return /^[#>*|\s_-]*$/.test(prefix);
}

function hasStrongMarker(text: string, pattern: RegExp): boolean {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );

  for (const match of text.matchAll(global)) {
    const index = match.index ?? 0;
    if (index < EARLY_WINDOW || isHeadingLike(text, index)) return true;
  }
  return false;
}

/**
 * Detecta os tipos presentes pelo texto do documento.
 * Devolve `null` quando não há marcador forte (o pipeline usa o modelo).
 */
export function detectDocumentTypes(input: {
  filename?: string | null;
  text: string;
}): HeuristicClassification | null {
  const text = normalize(input.text);
  if (text.length === 0) return null;

  const found = new Map<DocumentType, string[]>();

  for (const marker of MARKERS) {
    if (!hasStrongMarker(text, marker.pattern)) continue;
    const labels = found.get(marker.type) ?? [];
    labels.push(marker.label);
    found.set(marker.type, labels);
  }

  if (found.size === 0) return null;

  const types = DOCUMENT_TYPES.filter((type) => found.has(type));
  if (types.length === 0) return null;

  return {
    types,
    matches: types.flatMap((type) => found.get(type) ?? []),
  };
}

/** Texto útil de um `PreparedDocument` (só as partes de texto/markdown). */
export function preparedDocumentText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}
