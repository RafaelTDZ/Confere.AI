export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ListOptions = {
  page?: number | string | null;
  pageSize?: number | string | null;
  search?: string | null;
};

const SEARCH_MAX_LENGTH = 120;
const SEARCH_UNSAFE_CHARS = /[,()"']/g;

/** Converte número/string em inteiro; devolve `null` para qualquer outro valor. */
function toInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

/** Página válida: inteiro >= 1. Valores ausentes ou inválidos caem em 1. */
export function normalizePage(value: unknown): number {
  const parsed = toInteger(value);
  if (parsed === null || parsed < 1) return 1;
  return parsed;
}

/**
 * Tamanho de página válido: inteiro entre 1 e `MAX_PAGE_SIZE`.
 * Inválido/zero/negativo cai no padrão; acima do máximo é limitado ao máximo.
 */
export function normalizePageSize(value: unknown): number {
  const parsed = toInteger(value);
  if (parsed === null || parsed < 1) return DEFAULT_PAGE_SIZE;
  if (parsed > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return parsed;
}

/**
 * Normaliza o termo de busca para uso em `.ilike()`/`.or()`.
 * Remove caracteres que quebram a sintaxe do PostgREST (`:`, `,`, `(`, `)`,
 * aspas) e limita o tamanho para evitar filtros gigantes.
 */
export function normalizeSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(SEARCH_UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
}

/** Escapa `\`, `%` e `_` para que o termo seja tratado como literal no LIKE. */
export function escapeLike(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

/** Monta o envelope de paginação a partir das linhas da página e do total. */
export function buildPage<T>(
  rows: T[],
  total: number,
  page: number,
  pageSize: number,
): Page<T> {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  const safePage = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1;
  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.trunc(pageSize)
      : DEFAULT_PAGE_SIZE;
  return {
    rows,
    total: safeTotal,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(safeTotal / safePageSize)),
  };
}
