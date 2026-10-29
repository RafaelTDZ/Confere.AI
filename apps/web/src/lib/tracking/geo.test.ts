import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  geocodePort,
  normalizePortQuery,
  resolveRouteCoordinates,
} from "@/lib/tracking/geo";
import { FakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.db,
}));

const BASE_URL = "https://geo.example.test";
const USER_AGENT = "confere-ia-test/1.0";
const ORIGINAL_BASE_URL = process.env.GEOCODE_BASE_URL;
const ORIGINAL_USER_AGENT = process.env.GEOCODE_USER_AGENT;

function restoreEnv(): void {
  if (ORIGINAL_BASE_URL === undefined) delete process.env.GEOCODE_BASE_URL;
  else process.env.GEOCODE_BASE_URL = ORIGINAL_BASE_URL;
  if (ORIGINAL_USER_AGENT === undefined) delete process.env.GEOCODE_USER_AGENT;
  else process.env.GEOCODE_USER_AGENT = ORIGINAL_USER_AGENT;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cachedRow(overrides: Record<string, unknown> = {}) {
  return {
    query: "shekou, china",
    display_name: "Shekou, Nanshan, Shenzhen, China",
    lat: 22.4934,
    lng: 113.9167,
    provider: "nominatim",
    ...overrides,
  };
}

describe("normalizePortQuery", () => {
  it("gera a chave canônica do cache", () => {
    expect(normalizePortQuery("  Itapoá ,  Brasil ")).toBe("itapoa, brasil");
    expect(normalizePortQuery("SÃO   PAULO, BRASIL")).toBe("sao paulo, brasil");
    expect(normalizePortQuery("Shekou,China")).toBe("shekou, china");
  });

  it("devolve string vazia quando não há cidade/país", () => {
    expect(normalizePortQuery("")).toBe("");
    expect(normalizePortQuery("  ,  ")).toBe("");
  });
});

describe("geocodePort", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GEOCODE_BASE_URL = BASE_URL;
    process.env.GEOCODE_USER_AGENT = USER_AGENT;
    mocks.db = new FakeSupabase();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("usa o cache e não chama o Nominatim", async () => {
    const db = new FakeSupabase({ port_geocodes: [cachedRow()] });
    mocks.db = db;

    const result = await geocodePort({ query: "  Shekou ,  China " });

    expect(result).toEqual({
      lat: 22.4934,
      lng: 113.9167,
      displayName: "Shekou, Nanshan, Shenzhen, China",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.queries).toEqual([
      {
        table: "port_geocodes",
        operation: "select",
        filters: [{ column: "query", operator: "eq", value: "shekou, china" }],
      },
    ]);
  });

  it("consulta o Nominatim no miss e grava o cache", async () => {
    const db = new FakeSupabase();
    mocks.db = db;
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          lat: "22.4934",
          lon: "113.9167",
          display_name: "Shekou, Nanshan, Shenzhen, Guangdong, China",
        },
      ]),
    );

    const result = await geocodePort({ query: "Shekou, China" });

    expect(result?.lat).toBeCloseTo(22.4934);
    expect(result?.lng).toBeCloseTo(113.9167);
    expect(result?.displayName).toContain("Shenzhen");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(input).toBeInstanceOf(URL);
    const url = input as unknown as URL;
    expect(url.origin + url.pathname).toBe(`${BASE_URL}/search`);
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("q")).toBe("shekou, china");
    expect(init.headers).toMatchObject({ "User-Agent": USER_AGENT });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(db.rows("port_geocodes")).toEqual([
      expect.objectContaining({
        query: "shekou, china",
        display_name: "Shekou, Nanshan, Shenzhen, Guangdong, China",
        lat: 22.4934,
        lng: 113.9167,
        provider: "nominatim",
      }),
    ]);
  });

  it("não grava cache quando o Nominatim responde erro", async () => {
    const db = new FakeSupabase();
    mocks.db = db;
    fetchMock.mockResolvedValue(jsonResponse({ error: "rate limited" }, 429));

    await expect(geocodePort({ query: "Santos, Brasil" })).resolves.toBeNull();
    expect(db.rows("port_geocodes")).toEqual([]);
  });

  it("devolve null para JSON inválido", async () => {
    mocks.db = new FakeSupabase();
    fetchMock.mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(geocodePort({ query: "Santos, Brasil" })).resolves.toBeNull();
  });

  it("devolve null para coordenadas fora da faixa", async () => {
    const db = new FakeSupabase();
    mocks.db = db;
    fetchMock.mockResolvedValue(
      jsonResponse([{ lat: "999", lon: "0", display_name: "Lugar nenhum" }]),
    );

    await expect(geocodePort({ query: "Santos, Brasil" })).resolves.toBeNull();
    expect(db.rows("port_geocodes")).toEqual([]);
  });

  it("devolve null quando a consulta estoura o timeout", async () => {
    mocks.db = new FakeSupabase();
    fetchMock.mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );

    await expect(geocodePort({ query: "Santos, Brasil" })).resolves.toBeNull();
  });

  it("não faz duas chamadas externas para a mesma query", async () => {
    const db = new FakeSupabase();
    mocks.db = db;
    fetchMock.mockResolvedValue(
      jsonResponse([{ lat: "-26.2", lon: "-48.6", display_name: "Itapoá" }]),
    );

    const first = await geocodePort({ query: "Itapoá, Brasil" });
    const second = await geocodePort({ query: "itapoa,  brasil" });

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("port_geocodes")).toHaveLength(1);
  });

  it("compartilha a chamada em andamento da mesma query", async () => {
    mocks.db = new FakeSupabase();
    fetchMock.mockResolvedValue(
      jsonResponse([{ lat: "-23.9", lon: "-46.3", display_name: "Santos" }]),
    );

    const [first, second] = await Promise.all([
      geocodePort({ query: "Santos, Brasil" }),
      geocodePort({ query: "SANTOS, BRASIL" }),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("consulta vazia não toca no banco nem na rede", async () => {
    const db = new FakeSupabase();
    mocks.db = db;

    await expect(geocodePort({ query: " , " })).resolves.toBeNull();
    expect(db.queries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("segue para o Nominatim quando a leitura do cache falha", async () => {
    const db = new FakeSupabase();
    db.failNext("cache indisponível", {
      table: "port_geocodes",
      operation: "select",
    });
    mocks.db = db;
    fetchMock.mockResolvedValue(
      jsonResponse([{ lat: "-26.2", lon: "-48.6", display_name: "Itapoá" }]),
    );

    await expect(
      geocodePort({ query: "Itapoá, Brasil" }),
    ).resolves.toMatchObject({ lat: -26.2, lng: -48.6 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRouteCoordinates", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GEOCODE_BASE_URL = BASE_URL;
    process.env.GEOCODE_USER_AGENT = USER_AGENT;
    mocks.db = new FakeSupabase();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("resolve os dois lados em sequência", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          { lat: "22.4934", lon: "113.9167", display_name: "Shekou" },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ lat: "-26.2", lon: "-48.6", display_name: "Itapoá" }]),
      );

    const result = await resolveRouteCoordinates({
      origin: "Shekou, China",
      destination: "Itapoá, Brasil",
    });

    expect(result.origin).toMatchObject({ lat: 22.4934, lng: 113.9167 });
    expect(result.destination).toMatchObject({ lat: -26.2, lng: -48.6 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const queries = fetchMock.mock.calls.map(([input]) =>
      (input as URL).searchParams.get("q"),
    );
    expect(queries).toEqual(["shekou, china", "itapoa, brasil"]);
  });

  it("mantém um lado nulo sem derrubar o outro", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ lat: "-26.2", lon: "-48.6", display_name: "Itapoá" }]),
    );

    const result = await resolveRouteCoordinates({
      origin: null,
      destination: "Itapoá, Brasil",
    });

    expect(result.origin).toBeNull();
    expect(result.destination).toMatchObject({ lat: -26.2, lng: -48.6 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não consulta nada quando os dois lados são nulos", async () => {
    const result = await resolveRouteCoordinates({
      origin: null,
      destination: null,
    });

    expect(result).toEqual({ origin: null, destination: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
