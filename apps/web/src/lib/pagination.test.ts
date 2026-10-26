import { describe, expect, it } from "vitest";

import {
  buildPage,
  DEFAULT_PAGE_SIZE,
  escapeLike,
  MAX_PAGE_SIZE,
  normalizePage,
  normalizePageSize,
  normalizeSearch,
} from "@/lib/pagination";

describe("normalizePage", () => {
  it("usa 1 quando o valor é ausente ou inválido", () => {
    expect(normalizePage(undefined)).toBe(1);
    expect(normalizePage(null)).toBe(1);
    expect(normalizePage("")).toBe(1);
    expect(normalizePage("abc")).toBe(1);
    expect(normalizePage(Number.NaN)).toBe(1);
  });

  it("usa 1 para zero e valores negativos", () => {
    expect(normalizePage(0)).toBe(1);
    expect(normalizePage("0")).toBe(1);
    expect(normalizePage(-4)).toBe(1);
    expect(normalizePage("-2")).toBe(1);
  });

  it("aceita inteiros positivos em número ou string", () => {
    expect(normalizePage(3)).toBe(3);
    expect(normalizePage("7")).toBe(7);
    expect(normalizePage(2.9)).toBe(2);
  });
});

describe("normalizePageSize", () => {
  it("usa o padrão quando o valor é ausente ou inválido", () => {
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize("")).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(-10)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("aceita tamanhos válidos", () => {
    expect(normalizePageSize(5)).toBe(5);
    expect(normalizePageSize("8")).toBe(8);
    expect(normalizePageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it("limita ao máximo quando o valor ultrapassa o limite", () => {
    expect(normalizePageSize(MAX_PAGE_SIZE + 1)).toBe(MAX_PAGE_SIZE);
    expect(normalizePageSize("1000")).toBe(MAX_PAGE_SIZE);
  });
});

describe("normalizeSearch", () => {
  it("devolve string vazia para valores que não são string", () => {
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch(null)).toBe("");
    expect(normalizeSearch(42)).toBe("");
    expect(normalizeSearch(["termo"])).toBe("");
  });

  it("apara e colapsa espaços internos", () => {
    expect(normalizeSearch("   po   123   ")).toBe("po 123");
  });

  it("remove caracteres que quebram a sintaxe do PostgREST", () => {
    expect(normalizeSearch(`a,b(c)"d'e`)).toBe("abcde");
    expect(normalizeSearch("  a , b  ")).toBe("a b");
  });

  it("limita o termo a 120 caracteres", () => {
    const long = "x".repeat(150);
    expect(normalizeSearch(long)).toHaveLength(120);
    expect(normalizeSearch(`  ${long}  `)).toBe("x".repeat(120));
  });
});

describe("escapeLike", () => {
  it("mantém termos sem curingas", () => {
    expect(escapeLike("PO 123")).toBe("PO 123");
  });

  it("escapa %, _ e a barra invertida", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("PO_123")).toBe("PO\\_123");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });
});

describe("buildPage", () => {
  it("devolve totalPages 1 quando não há registros", () => {
    const page = buildPage<string>([], 0, 1, DEFAULT_PAGE_SIZE);

    expect(page).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 1,
    });
  });

  it("arredonda para cima o número de páginas", () => {
    const page = buildPage(["a", "b"], 11, 2, 5);

    expect(page.rows).toEqual(["a", "b"]);
    expect(page.total).toBe(11);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(5);
    expect(page.totalPages).toBe(3);
  });

  it("não cria página extra quando o total é múltiplo do tamanho", () => {
    expect(buildPage([], 10, 1, 5).totalPages).toBe(2);
  });

  it("trata total inválido como zero", () => {
    const page = buildPage([], Number.NaN, 1, DEFAULT_PAGE_SIZE);

    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(1);
  });
});
