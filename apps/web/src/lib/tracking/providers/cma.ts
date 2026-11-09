import "server-only";

/**
 * Parser nativo do markdown do portal da CMA CGM.
 *
 * A página é uma SPA atrás do DataDome: sem preencher o formulário (ações) não
 * há dados, e a extração por LLM custa 5 créditos + ~10-20s. O markdown traz a
 * tabela de movimentos de forma regular, então extraímos aqui (1 crédito) e
 * caímos para a extração JSON quando o layout não é reconhecido.
 */

export type CmaTrackingEvent = {
  date: string;
  location: string | null;
  description: string;
};

export type CmaTrackingData = {
  found: boolean;
  carrier: string | null;
  vessel: string | null;
  voyage: string | null;
  eta: string | null;
  pol: string | null;
  pod: string | null;
  containers: Array<{
    number: string;
    status: string | null;
    events: CmaTrackingEvent[];
  }>;
  notes: string | null;
};

const CONTAINER_RE = /\*\*([A-Z]{4}\d{7})\*\*/;
const DATE_CELL_RE =
  /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*(\d{1,2}:\d{2})\s*(AM|PM)?/i;
const POL_RE = /-\s*POL\s*\*\*([^*]+)\*\*/i;
const POD_RE = /-\s*POD\s*\*\*([^*]+)\*\*/i;
const ETA_RE = /ETA Berth at POD\s*\n+\s*([^\n]+)/i;
const VESSEL_LINK_RE = /\[([^\]]+)\]\([^)]*\/vessel\/[^)]*\)/i;
const VOYAGE_RE = /VoyageReference=([A-Z0-9]+)/i;

function clean(value: string | undefined | null): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "06-OCT-202608:54 PM" → "06-OCT-2026 08:54 PM" (formato que o normalizador lê). */
function normalizeCellDate(cell: string): string | null {
  const match = DATE_CELL_RE.exec(cell);
  if (!match) return null;
  const [, day, month, year, time, meridiem] = match;
  return `${day}-${month}-${year} ${time}${meridiem ? ` ${meridiem}` : ""}`.trim();
}

function readVoyage(cell: string): string | null {
  const explicit = VOYAGE_RE.exec(cell)?.[1];
  if (explicit) return explicit;
  // `[( 0BDPHW1MA)](url)` quando o link não traz VoyageReference.
  const short = /\[\s*\(\s*([A-Z0-9]{6,})\s*\)\s*\]/.exec(cell)?.[1];
  return short ?? null;
}

export function parseCmaMarkdown(
  markdown: string,
  queryValue: string,
): CmaTrackingData | null {
  const text = markdown.replace(/\r/g, "");
  if (!/tracking details/i.test(text)) return null;

  const containerMatch = CONTAINER_RE.exec(text)?.[1] ?? null;
  const normalizedQuery = queryValue.trim().toUpperCase();
  const containerNumber =
    containerMatch ??
    (/^[A-Z]{4}\d{7}$/.test(normalizedQuery) ? normalizedQuery : null);

  const events: CmaTrackingEvent[] = [];
  let vessel: string | null = null;
  let voyage: string | null = null;

  for (const line of text.split("\n")) {
    if (!line.includes("|")) continue;
    const dateIndex = line
      .split("|")
      .findIndex((cell) => DATE_CELL_RE.test(cell));
    if (dateIndex === -1) continue;

    const cells = line.split("|").map((cell) => cell.trim());
    const date = normalizeCellDate(cells[dateIndex] ?? "");
    const description = clean(cells[dateIndex + 1]);
    if (!date || !description) continue;

    const location = clean(cells[dateIndex + 2]) || null;
    const vesselCell = cells[dateIndex + 3] ?? "";

    events.push({ date, location, description });

    // Navio/viagem do cabeçalho = primeiro evento **realizado** com esses dados
    // (a linha "Planned" usa a viagem prevista, não a atual).
    if (!vessel && !/planned/i.test(description)) {
      vessel = clean(VESSEL_LINK_RE.exec(vesselCell)?.[1]) || null;
      voyage = readVoyage(vesselCell);
    }
  }

  if (events.length === 0 && !containerNumber) return null;

  const etaCell = ETA_RE.exec(text)?.[1]?.trim() ?? null;
  const eta = etaCell ? (normalizeCellDate(etaCell) ?? etaCell) : null;

  return {
    found: true,
    carrier: "CMA CGM",
    vessel,
    voyage,
    eta,
    pol: clean(POL_RE.exec(text)?.[1]) || null,
    pod: clean(POD_RE.exec(text)?.[1]) || null,
    containers: [
      {
        number: containerNumber ?? normalizedQuery,
        status: events[0]?.description ?? null,
        events,
      },
    ],
    notes: null,
  };
}
