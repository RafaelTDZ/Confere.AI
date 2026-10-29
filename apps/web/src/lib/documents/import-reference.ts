import "server-only";

import { normalizeImportKey } from "@/lib/documents/imports-shared";

/**
 * Referência da importação a partir do próprio arquivo.
 *
 * Prioriza campos explícitos do documento (`EXPORT REFERENCES`, `REFERENCE`,
 * `CONTRACT NO.`, `PO NO.`, `BOOKING NO.`) e, quando não há nada utilizável,
 * usa o código do nome do arquivo (`OYH128 draft bl - ...pdf` → `OYH128`).
 * Valores que só repetem o número da Invoice/BL são descartados — a UI já os
 * mostra em campos próprios.
 */

export type ImportReferenceCandidate = {
  value: string;
  source: "document" | "filename";
};

const MAX_REFERENCE_LENGTH = 120;

/** Campos de referência aceitos, na ordem de prioridade. */
const LABEL = String.raw`(?:NO\.?|NUMBER|#)(?=[\s:]|$)`;

const DOCUMENT_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\bEXPORT\s+REFERENCES?\b\s*(?:${LABEL}\s*)?:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bBOOKING\s*${LABEL}\s*:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bCONTRACT\s*${LABEL}\s*:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bP\.?\s*O\.?\s*${LABEL}\s*:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bPURCHASE\s+ORDER\b\s*(?:${LABEL}\s*)?:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bORDER\s*${LABEL}\s*:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bREFERENCE\s*${LABEL}\s*:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bREFERENCE\s*:\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
  new RegExp(
    String.raw`\bREF\.?\s*${LABEL}\s*:?\s*([^\s<|][^<\n|]{0,40})`,
    "i",
  ),
];

/**
 * O campo só vale no topo do documento ou como título de linha — o clausulado
 * do BL cita "incorporated by reference" e não é referência da importação.
 */
const EARLY_WINDOW = 4_000;

function isHeadingLike(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const prefix = text.slice(lineStart, index);
  return /^[#>*|\s_-]*$/.test(prefix);
}

/** Código curto no início do nome do arquivo (ex.: OYH128). */
const FILENAME_CODE = /^([A-Za-z]{2,8}\d{1,8})(?=$|[\s._-])/;

const INVALID_REFERENCES = new Set([
  "",
  "-",
  "--",
  "N/A",
  "NA",
  "N/M",
  "NM",
  "NONE",
  "NULL",
  "NIL",
  "S/N",
  "SEM",
  "SEE ATTACHED RIDER",
  "SEE THE ATTACHED RIDER",
]);

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,;:.]+$/, "")
    .trim();
  if (!trimmed) return null;

  // Precisa começar com letra/dígito: evita capturar ":" ou "-" soltos.
  if (!/^[A-Za-z0-9]/.test(trimmed)) return null;

  const candidate = trimmed.slice(0, MAX_REFERENCE_LENGTH).trim();
  if (!candidate) return null;
  if (INVALID_REFERENCES.has(candidate.toUpperCase())) return null;

  return candidate;
}

function isRedundant(
  value: string,
  equivalents: Array<string | null | undefined>,
): boolean {
  const normalized = normalizeImportKey(value);
  if (!normalized) return true;
  return equivalents.some(
    (other) => other && normalizeImportKey(other) === normalized,
  );
}

export function extractImportReference(input: {
  filename?: string | null;
  markdown?: string | null;
  invoiceNumber?: string | null;
  blNumber?: string | null;
}): ImportReferenceCandidate | null {
  const equivalents = [input.invoiceNumber, input.blNumber];

  const text = input.markdown ?? "";
  for (const pattern of DOCUMENT_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);

    for (const match of text.matchAll(global)) {
      const index = match.index ?? 0;
      if (index >= EARLY_WINDOW && !isHeadingLike(text, index)) continue;

      const value = clean(match[1]);
      if (!value) continue;
      if (isRedundant(value, equivalents)) continue;
      return { value, source: "document" };
    }
  }

  const filename = (input.filename ?? "").trim();
  if (filename) {
    const base = filename.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim();
    const match = base.match(FILENAME_CODE);
    const value = clean(match?.[1]);
    if (value && !isRedundant(value, equivalents)) {
      return { value, source: "filename" };
    }
  }

  return null;
}
