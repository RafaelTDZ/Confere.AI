import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const parseStore = vi.hoisted(() => ({
  getCachedDocumentParse: vi.fn(),
  saveDocumentParse: vi.fn(),
  getDocumentParseCreditsUsed: vi.fn(),
  consumeDocumentParseCredits: vi.fn(),
}));

const adminMock = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/documents/document-parses", () => parseStore);
vi.mock("@/lib/supabase/admin", () => adminMock);

import {
  documentParseMaxChars,
  documentParseMaxPages,
  documentParseMinChars,
  documentParseMonthlyCredits,
  documentParseOcrMode,
  documentParseTimeoutMs,
  isDocumentParseEnabled,
  parsePdfWithFirecrawl,
} from "@/lib/ai/document-parse";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SHA256 = "a".repeat(64);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 teste");
const MARKDOWN = `# Bill of Lading\n${Array.from(
  { length: 30 },
  () => "conteudo extraido do documento",
).join(" ")}`;

const fetchMock = vi.fn<
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>
>();

function pdfParams(
  overrides: Partial<{
    tenantId: string;
    sha256: string;
    bytes: Uint8Array;
    filename: string;
  }> = {},
) {
  return {
    tenantId: TENANT_ID,
    sha256: SHA256,
    bytes: PDF_BYTES,
    filename: "bl.pdf",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function firstFetchCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("fetch não foi chamado");
  const [input, init] = call;
  if (!init) throw new Error("fetch chamado sem init");
  return { url: String(input), init };
}

function uploadedFile(body: FormData): File {
  const entry = body.get("file");
  if (!(entry instanceof File)) throw new Error("file ausente no FormData");
  return entry;
}

function uploadedOptions(body: FormData): unknown {
  const entry = body.get("options");
  if (typeof entry !== "string") throw new Error("options ausente");
  return JSON.parse(entry);
}

beforeEach(() => {
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-teste");
  vi.stubEnv("FIRECRAWL_BASE_URL", "");
  vi.stubEnv("DOCUMENT_PARSE_PROVIDER", "");
  vi.stubEnv("DOCUMENT_PARSE_MAX_PAGES", "");
  vi.stubEnv("DOCUMENT_PARSE_OCR_MODE", "");
  vi.stubEnv("DOCUMENT_PARSE_MONTHLY_CREDITS", "");
  vi.stubEnv("DOCUMENT_PARSE_MIN_CHARS", "");
  vi.stubEnv("DOCUMENT_PARSE_MAX_CHARS", "");
  vi.stubEnv("DOCUMENT_PARSE_TIMEOUT_MS", "");
  vi.stubGlobal("fetch", fetchMock);

  fetchMock.mockClear();
  parseStore.getCachedDocumentParse.mockReset().mockResolvedValue(null);
  parseStore.saveDocumentParse.mockReset().mockResolvedValue(undefined);
  parseStore.getDocumentParseCreditsUsed.mockReset().mockResolvedValue(0);
  parseStore.consumeDocumentParseCredits.mockReset().mockResolvedValue(true);

  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configuração do parse", () => {
  it("usa os padrões quando as variáveis estão vazias", () => {
    expect(documentParseMaxPages()).toBe(30);
    expect(documentParseOcrMode()).toBe("auto");
    expect(documentParseMonthlyCredits()).toBe(5000);
    expect(documentParseMinChars()).toBe(200);
    expect(documentParseMaxChars()).toBe(120000);
    expect(documentParseTimeoutMs()).toBe(90000);
  });

  it("respeita valores válidos das variáveis", () => {
    vi.stubEnv("DOCUMENT_PARSE_MAX_PAGES", "10");
    vi.stubEnv("DOCUMENT_PARSE_OCR_MODE", "OCR");
    vi.stubEnv("DOCUMENT_PARSE_MONTHLY_CREDITS", "0");
    vi.stubEnv("DOCUMENT_PARSE_MIN_CHARS", "50");
    vi.stubEnv("DOCUMENT_PARSE_MAX_CHARS", "1000");
    vi.stubEnv("DOCUMENT_PARSE_TIMEOUT_MS", "30000");

    expect(documentParseMaxPages()).toBe(10);
    expect(documentParseOcrMode()).toBe("ocr");
    expect(documentParseMonthlyCredits()).toBe(0);
    expect(documentParseMinChars()).toBe(50);
    expect(documentParseMaxChars()).toBe(1000);
    expect(documentParseTimeoutMs()).toBe(30000);
  });

  it("cai no padrão para valores inválidos", () => {
    vi.stubEnv("DOCUMENT_PARSE_MAX_PAGES", "abc");
    vi.stubEnv("DOCUMENT_PARSE_OCR_MODE", "turbo");
    vi.stubEnv("DOCUMENT_PARSE_MONTHLY_CREDITS", "-10");
    vi.stubEnv("DOCUMENT_PARSE_TIMEOUT_MS", "500");

    expect(documentParseMaxPages()).toBe(30);
    expect(documentParseOcrMode()).toBe("auto");
    expect(documentParseMonthlyCredits()).toBe(5000);
    expect(documentParseTimeoutMs()).toBe(90000);
  });

  it("aceita o modo fast", () => {
    vi.stubEnv("DOCUMENT_PARSE_OCR_MODE", "fast");
    expect(documentParseOcrMode()).toBe("fast");
  });

  it("habilita o parse com chave e provider padrão", () => {
    expect(isDocumentParseEnabled()).toBe(true);

    vi.stubEnv("DOCUMENT_PARSE_PROVIDER", "firecrawl");
    expect(isDocumentParseEnabled()).toBe(true);
  });

  it("desabilita o parse com provider de imagens ou sem chave", () => {
    vi.stubEnv("DOCUMENT_PARSE_PROVIDER", "images");
    expect(isDocumentParseEnabled()).toBe(false);

    vi.stubEnv("DOCUMENT_PARSE_PROVIDER", "");
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    expect(isDocumentParseEnabled()).toBe(false);
  });
});

describe("parsePdfWithFirecrawl", () => {
  it("usa o cache e não chama o Firecrawl", async () => {
    parseStore.getCachedDocumentParse.mockResolvedValue({
      markdown: MARKDOWN,
      pages: 3,
      credits: 3,
    });

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: true,
      document: {
        markdown: MARKDOWN,
        pages: 3,
        credits: 0,
        cached: true,
      },
    });
    expect(parseStore.getCachedDocumentParse).toHaveBeenCalledWith(
      TENANT_ID,
      SHA256,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(parseStore.consumeDocumentParseCredits).not.toHaveBeenCalled();
    expect(parseStore.saveDocumentParse).not.toHaveBeenCalled();
  });

  it("ignora cache curto e refaz o parse", async () => {
    parseStore.getCachedDocumentParse.mockResolvedValue({
      markdown: "curto demais",
      pages: 1,
      credits: 1,
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: MARKDOWN, metadata: { numPages: 2 } },
      }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      document: { pages: 2, credits: 2, cached: false },
    });
  });

  it("envia o PDF, as opções e persiste o resultado", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: MARKDOWN, metadata: { numPages: 4 } },
      }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: true,
      document: { markdown: MARKDOWN, pages: 4, credits: 4, cached: false },
    });

    const { url, init } = firstFetchCall();
    expect(url).toBe("https://api.firecrawl.dev/v2/parse");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer fc-teste" });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    if (!(init.body instanceof FormData)) {
      throw new Error("body deveria ser FormData");
    }
    const file = uploadedFile(init.body);
    expect(file.name).toBe("bl.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe("%PDF-1.7 teste");

    expect(uploadedOptions(init.body)).toEqual({
      formats: ["markdown"],
      parsers: [
        { type: "pdf", mode: "auto", maxPages: 30, pages: true },
      ],
    });

    expect(parseStore.consumeDocumentParseCredits).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      credits: 4,
      limit: 5000,
    });
    expect(parseStore.saveDocumentParse).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      sha256: SHA256,
      markdown: MARKDOWN,
      pages: 4,
      credits: 4,
    });
  });

  it("usa FIRECRAWL_BASE_URL e as opções de OCR configuradas", async () => {
    vi.stubEnv("FIRECRAWL_BASE_URL", "https://proxy.exemplo.com/");
    vi.stubEnv("DOCUMENT_PARSE_OCR_MODE", "ocr");
    vi.stubEnv("DOCUMENT_PARSE_MAX_PAGES", "5");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: MARKDOWN, metadata: { numPages: 2 } },
      }),
    );

    await parsePdfWithFirecrawl(pdfParams());

    const { url, init } = firstFetchCall();
    expect(url).toBe("https://proxy.exemplo.com/v2/parse");

    if (!(init.body instanceof FormData)) {
      throw new Error("body deveria ser FormData");
    }
    expect(uploadedOptions(init.body)).toEqual({
      formats: ["markdown"],
      parsers: [{ type: "pdf", mode: "ocr", maxPages: 5, pages: true }],
    });
  });

  it("assume uma página quando a resposta não traz numPages", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { markdown: MARKDOWN } }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: true,
      document: { pages: 1, credits: 1 },
    });
    expect(parseStore.consumeDocumentParseCredits).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      credits: 1,
      limit: 5000,
    });
  });

  it("trunca o markdown em DOCUMENT_PARSE_MAX_CHARS", async () => {
    vi.stubEnv("DOCUMENT_PARSE_MAX_CHARS", "300");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: MARKDOWN, metadata: { numPages: 2 } },
      }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    if (!result.ok) throw new Error("parse deveria ter sucesso");
    expect(result.document.markdown).toHaveLength(300);
    expect(result.document.markdown).toBe(MARKDOWN.slice(0, 300));
    expect(parseStore.saveDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: MARKDOWN.slice(0, 300) }),
    );
  });

  it("não chama o Firecrawl quando o orçamento está esgotado", async () => {
    vi.stubEnv("DOCUMENT_PARSE_MONTHLY_CREDITS", "10");
    parseStore.getDocumentParseCreditsUsed.mockResolvedValue(10);

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: false, errorCode: "budget_exhausted" });
    expect(parseStore.getDocumentParseCreditsUsed).toHaveBeenCalledWith(
      TENANT_ID,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não consulta o consumo quando o teto é 0", async () => {
    vi.stubEnv("DOCUMENT_PARSE_MONTHLY_CREDITS", "0");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { markdown: MARKDOWN } }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: true });
    expect(parseStore.getDocumentParseCreditsUsed).not.toHaveBeenCalled();
    expect(parseStore.consumeDocumentParseCredits).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      credits: 1,
      limit: 0,
    });
  });

  it.each([
    { status: 401, errorCode: "firecrawl_unauthorized" },
    { status: 402, errorCode: "firecrawl_no_credits" },
    { status: 429, errorCode: "firecrawl_rate_limited" },
    { status: 500, errorCode: "firecrawl_unavailable" },
    { status: 400, errorCode: "firecrawl_error" },
  ])("mapeia HTTP $status para $errorCode", async ({ status, errorCode }) => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "falha no Firecrawl" }, status),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode,
      errorMessage: "falha no Firecrawl",
    });
    expect(parseStore.consumeDocumentParseCredits).not.toHaveBeenCalled();
    expect(parseStore.saveDocumentParse).not.toHaveBeenCalled();
  });

  it("usa a mensagem padrão quando o erro HTTP não tem JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("indisponível", { status: 402 }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode: "firecrawl_no_credits",
      errorMessage: "Firecrawl respondeu 402.",
    });
  });

  it("mapeia falha lógica (success: false) com 200", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: false,
        code: "PDF_UNPROCESSABLE",
        error: { message: "PDF protegido" },
      }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode: "firecrawl_error",
      errorMessage: "PDF protegido",
    });
  });

  it("usa o code da resposta quando não há mensagem", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, code: "TIME_LIMIT" }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode: "firecrawl_error",
      errorMessage: "TIME_LIMIT",
    });
  });

  it("usa a mensagem padrão quando o erro não traz texto", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: { code: 7 } }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode: "firecrawl_error",
      errorMessage: "Firecrawl não conseguiu processar o PDF.",
    });
  });

  it("rejeita sucesso sem bloco data", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: false,
      errorCode: "firecrawl_invalid_response",
    });
  });

  it("rejeita markdown curto sem cachear nem gastar crédito", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { markdown: "curto" } }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: false, errorCode: "parse_too_short" });
    expect(parseStore.consumeDocumentParseCredits).not.toHaveBeenCalled();
    expect(parseStore.saveDocumentParse).not.toHaveBeenCalled();
  });

  it("rejeita resposta que não é JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nao e json", { status: 200 }));

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: false,
      errorCode: "firecrawl_invalid_response",
    });
  });

  it("rejeita JSON sem markdown", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: false,
      errorCode: "firecrawl_invalid_response",
    });
  });

  it("rejeita markdown vazio", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { markdown: "   " } }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: false,
      errorCode: "firecrawl_invalid_response",
    });
  });

  it("mapeia erro de rede", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode: "firecrawl_network_error",
      errorMessage: "fetch failed",
    });
  });

  it("mapeia rejeição que não é Error", async () => {
    fetchMock.mockRejectedValueOnce("sem rede");

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: false,
      errorCode: "firecrawl_network_error",
      errorMessage: "sem rede",
    });
  });

  it("mapeia timeout do AbortSignal", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("tempo esgotado", "TimeoutError"),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toEqual({
      ok: false,
      errorCode: "firecrawl_timeout",
      errorMessage: "Firecrawl não respondeu em 90000 ms.",
    });
  });

  it("mapeia abort manual como timeout", async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException("abortado", "AbortError"),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: false, errorCode: "firecrawl_timeout" });
  });

  it("valida a entrada antes de qualquer chamada", async () => {
    const invalidos = [
      { bytes: new Uint8Array(0) },
      { sha256: "123" },
      { tenantId: "  " },
      { filename: "" },
      { bytes: "%PDF" as unknown as Uint8Array },
    ];

    for (const invalido of invalidos) {
      const result = await parsePdfWithFirecrawl(pdfParams(invalido));
      expect(result).toMatchObject({ ok: false, errorCode: "invalid_input" });
    }

    expect(parseStore.getCachedDocumentParse).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não chama o Firecrawl quando o parse está desligado", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: false, errorCode: "parse_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("desliga o parse quando a chave não está definida", async () => {
    delete process.env.FIRECRAWL_API_KEY;

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: false, errorCode: "parse_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("entrega o parse mesmo quando o cache falha ao salvar", async () => {
    parseStore.saveDocumentParse.mockRejectedValueOnce(new Error("db off"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: MARKDOWN, metadata: { numPages: 2 } },
      }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({
      ok: true,
      document: { pages: 2, credits: 2, cached: false },
    });
    expect(console.warn).toHaveBeenCalled();
  });

  it("entrega o parse e avisa quando o orçamento estoura no registro", async () => {
    parseStore.consumeDocumentParseCredits.mockResolvedValueOnce(false);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: MARKDOWN, metadata: { numPages: 2 } },
      }),
    );

    const result = await parsePdfWithFirecrawl(pdfParams());

    expect(result).toMatchObject({ ok: true });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("orçamento de parse excedido"),
    );
  });
});

// ---------------------------------------------------------------------------
// Contrato do módulo real (`document-parses`): cache e orçamento via service
// role. O módulo é mockado nos testes acima; aqui ele roda de verdade contra um
// client fake, cobrindo SQL/upsert/RPC e o comportamento "nunca lança".
// ---------------------------------------------------------------------------

type CacheRow = { markdown: string; pages: number; credits: number };
type DbError = { message: string };

type Filter = { column: string; value: unknown };

type QueryBuilder<T> = {
  eq(column: string, value: unknown): QueryBuilder<T>;
  maybeSingle(): Promise<T>;
};

function query<T>(
  result: T,
  filters: Filter[],
): QueryBuilder<T> {
  const builder: QueryBuilder<T> = {
    eq: (column, value) => {
      filters.push({ column, value });
      return builder;
    },
    maybeSingle: async () => result,
  };
  return builder;
}

type AdminResponses = {
  cacheRow?: CacheRow | null;
  cacheError?: DbError | null;
  usageRow?: { credits_used: number } | null;
  usageError?: DbError | null;
  upsertError?: DbError | null;
  rpcData?: boolean | null;
  rpcError?: DbError | null;
  throwOn?: "select" | "upsert" | "rpc";
};

type AdminLog = {
  selects: string[];
  filters: Filter[];
  upserts: Array<{ table: string; values: unknown; options: unknown }>;
  rpcs: Array<{ fn: string; args: unknown }>;
};

function fakeAdmin(log: AdminLog, responses: AdminResponses) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          log.selects.push(`${table}:${columns}`);
          if (responses.throwOn === "select") throw new Error("select falhou");
          return query(
            {
              data:
                table === "document_parses"
                  ? (responses.cacheRow ?? null)
                  : (responses.usageRow ?? null),
              error:
                table === "document_parses"
                  ? (responses.cacheError ?? null)
                  : (responses.usageError ?? null),
            },
            log.filters,
          );
        },
        upsert(values: unknown, options: unknown) {
          log.upserts.push({ table, values, options });
          if (responses.throwOn === "upsert") throw new Error("upsert falhou");
          return Promise.resolve({ error: responses.upsertError ?? null });
        },
      };
    },
    rpc(fn: string, args: unknown) {
      log.rpcs.push({ fn, args });
      if (responses.throwOn === "rpc") throw new Error("rpc falhou");
      return Promise.resolve({
        data: responses.rpcData ?? null,
        error: responses.rpcError ?? null,
      });
    },
  };
}

function newLog(): AdminLog {
  return { selects: [], filters: [], upserts: [], rpcs: [] };
}

describe("document-parses (cache e orçamento)", () => {
  let parses: typeof import("@/lib/documents/document-parses");

  beforeAll(async () => {
    parses = await vi.importActual<
      typeof import("@/lib/documents/document-parses")
    >("@/lib/documents/document-parses");
  });

  it("lê o cache filtrando tenant e sha256", async () => {
    const log = newLog();
    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, {
        cacheRow: { markdown: MARKDOWN, pages: 2, credits: 2 },
      }),
    );

    const cached = await parses.getCachedDocumentParse(TENANT_ID, SHA256);

    expect(cached).toEqual({ markdown: MARKDOWN, pages: 2, credits: 2 });
    expect(log.selects).toEqual(["document_parses:markdown, pages, credits"]);
    expect(log.filters).toEqual([
      { column: "tenant_id", value: TENANT_ID },
      { column: "sha256", value: SHA256 },
    ]);
  });

  it("devolve null quando não há cache, em erro ou exceção", async () => {
    const log = newLog();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { cacheRow: null }),
    );
    await expect(
      parses.getCachedDocumentParse(TENANT_ID, SHA256),
    ).resolves.toBeNull();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { cacheError: { message: "sem permissão" } }),
    );
    await expect(
      parses.getCachedDocumentParse(TENANT_ID, SHA256),
    ).resolves.toBeNull();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { throwOn: "select" }),
    );
    await expect(
      parses.getCachedDocumentParse(TENANT_ID, SHA256),
    ).resolves.toBeNull();

    expect(console.error).toHaveBeenCalled();
  });

  it("grava o cache com upsert que ignora duplicado", async () => {
    const log = newLog();
    adminMock.createSupabaseAdminClient.mockReturnValue(fakeAdmin(log, {}));

    await parses.saveDocumentParse({
      tenantId: TENANT_ID,
      sha256: SHA256,
      markdown: MARKDOWN,
      pages: 2,
      credits: 2,
    });

    expect(log.upserts).toEqual([
      {
        table: "document_parses",
        values: {
          tenant_id: TENANT_ID,
          sha256: SHA256,
          provider: "firecrawl",
          markdown: MARKDOWN,
          pages: 2,
          credits: 2,
        },
        options: { onConflict: "tenant_id,sha256", ignoreDuplicates: true },
      },
    ]);
  });

  it("não lança quando o cache falha ao salvar", async () => {
    const log = newLog();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { upsertError: { message: "duplicado" } }),
    );
    await expect(
      parses.saveDocumentParse({
        tenantId: TENANT_ID,
        sha256: SHA256,
        markdown: MARKDOWN,
        pages: 1,
        credits: 1,
      }),
    ).resolves.toBeUndefined();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { throwOn: "upsert" }),
    );
    await expect(
      parses.saveDocumentParse({
        tenantId: TENANT_ID,
        sha256: SHA256,
        markdown: MARKDOWN,
        pages: 1,
        credits: 1,
      }),
    ).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalled();
  });

  it("lê o consumo do mês (YYYY-MM em UTC)", async () => {
    const log = newLog();
    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { usageRow: { credits_used: 42 } }),
    );

    await expect(
      parses.getDocumentParseCreditsUsed(TENANT_ID),
    ).resolves.toBe(42);
    expect(log.filters).toEqual([
      { column: "tenant_id", value: TENANT_ID },
      { column: "period", value: expect.stringMatching(/^\d{4}-\d{2}$/) },
    ]);
  });

  it("devolve 0 quando o consumo falha ou não existe", async () => {
    const log = newLog();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { usageRow: null }),
    );
    await expect(
      parses.getDocumentParseCreditsUsed(TENANT_ID),
    ).resolves.toBe(0);

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { usageError: { message: "offline" } }),
    );
    await expect(
      parses.getDocumentParseCreditsUsed(TENANT_ID),
    ).resolves.toBe(0);

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { throwOn: "select" }),
    );
    await expect(
      parses.getDocumentParseCreditsUsed(TENANT_ID),
    ).resolves.toBe(0);
  });

  it("consome créditos pela RPC atômica com o teto do mês", async () => {
    const log = newLog();
    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { rpcData: true }),
    );

    await expect(
      parses.consumeDocumentParseCredits({
        tenantId: TENANT_ID,
        credits: 3,
        limit: 5000,
      }),
    ).resolves.toBe(true);

    expect(log.rpcs).toHaveLength(1);
    expect(log.rpcs[0]?.fn).toBe("consume_document_parse_credits");
    expect(log.rpcs[0]?.args).toEqual({
      p_tenant_id: TENANT_ID,
      p_period: expect.stringMatching(/^\d{4}-\d{2}$/),
      p_credits: 3,
      p_limit: 5000,
    });
  });

  it("devolve false quando a RPC barra o teto", async () => {
    const log = newLog();
    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { rpcData: false }),
    );

    await expect(
      parses.consumeDocumentParseCredits({
        tenantId: TENANT_ID,
        credits: 3,
        limit: 10,
      }),
    ).resolves.toBe(false);
  });

  it("libera o parse quando o registro de créditos falha", async () => {
    const log = newLog();

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { rpcError: { message: "timeout" } }),
    );
    await expect(
      parses.consumeDocumentParseCredits({
        tenantId: TENANT_ID,
        credits: 1,
        limit: 0,
      }),
    ).resolves.toBe(true);

    adminMock.createSupabaseAdminClient.mockReturnValue(
      fakeAdmin(log, { throwOn: "rpc" }),
    );
    await expect(
      parses.consumeDocumentParseCredits({
        tenantId: TENANT_ID,
        credits: 1,
        limit: 0,
      }),
    ).resolves.toBe(true);

    expect(console.error).toHaveBeenCalled();
  });
});

