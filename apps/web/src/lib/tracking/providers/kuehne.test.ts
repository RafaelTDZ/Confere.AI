import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKuehneScrapeUrl,
  fetchKuehneTracking,
  kuehneEventStatus,
  kuehneMilestoneDescription,
  normalizeKuehneResponse,
  selectKuehneCandidates,
} from "@/lib/tracking/providers/kuehne";

/** Resposta real de `/internal/shipment-list?query=SK#606N000455SZ1`. */
const blListFixture = {
  totalResults: 1,
  searchResultsByType: [
    {
      kind: "reference.OBL",
      numberOfResults: 1,
      shipments: [
        {
          id: 522814459,
          modeOfTransport: "sea",
          trackingNumber: "1076358717",
          from: "Shenzhen / CN",
          to: "Riyadh Dry Port / SA",
          stage: "stage.booked",
        },
      ],
    },
  ],
};

/** Resposta real da busca por container (TEST123456). */
const containerListFixture = {
  totalResults: 3,
  searchResultsByType: [
    {
      kind: "reference.CN",
      numberOfResults: 2,
      shipments: [
        {
          id: 522814459,
          modeOfTransport: "sea",
          trackingNumber: "1076358717",
          stage: "stage.booked",
        },
        {
          id: 525569072,
          modeOfTransport: "sea",
          trackingNumber: "1076978651",
          stage: "stage.in-transit",
        },
      ],
    },
    {
      kind: "reference.HAW",
      numberOfResults: 1,
      shipments: [
        {
          id: 527138684,
          modeOfTransport: "air",
          trackingNumber: "1077301967",
          stage: "stage.booked",
        },
      ],
    },
  ],
};

/** Resposta real do `abstract` do embarque 525569072. */
const abstractFixture = {
  primaryReference: "1076978651",
  modeOfTransport: "SEA",
  from: "Hamburg / DE",
  to: "Jeddah / SA",
  stage: "stage.in-transit",
  currentMilestone: "information-milestone.booking-acknowledgement",
  currentMilestoneLocation: "",
  currentMilestoneDate: "2026-08-31T13:30:41",
  isFollowed: false,
  isFavored: false,
  favored: false,
  followed: false,
};

/**
 * Resposta real do `content` do embarque 525569072. O portal usa o container
 * de demonstração `TEST123456`, que não segue a ISO 6346 (4 letras + 7 dígitos)
 * e por isso é descartado pela normalização.
 */
const contentFixture = {
  serviceType: "fcl",
  hasDangerousGoods: false,
  numberOfPackages: 1,
  countOfContainer: 1,
  container: [
    {
      containerNumber: "TEST123456",
      containerType: "20 ft Container",
      hasDangerousGoods: false,
    },
  ],
};

/** O mesmo `content` com um container ISO 6346 válido (carga real). */
const validContentFixture = {
  ...contentFixture,
  container: [
    {
      containerNumber: "TCKU7925277",
      containerType: "20 ft Container",
      hasDangerousGoods: false,
    },
  ],
};

/** Resposta real do `shipment-routing` do embarque 525569072. */
const routingFixture = {
  modeOfTransport: "SEA",
  routeLocations: [
    {
      source: "REAL",
      reached: true,
      completed: true,
      labelIdentifier: "route-location.departure.sea",
      location: {
        locationCode: "DEHAM",
        unLocationCode: "DEHAM",
        countryCode: "DE",
        countryName: "GERMANY",
        internationalName: "Hamburg",
      },
      locationMilestones: [
        {
          labelIdentifier: "location-milestone.departure.vehicle-departed.sea",
          reached: true,
          achievementDateTime: {
            condition: "ACTUAL",
            dateTime: {
              date: "2026-07-02",
              localDateTime: "2026-07-02T00:00:00",
              offsetDateTime: "2026-07-02T00:00:00+00:00",
            },
          },
          actualAchievementDateTime: {
            condition: "ACTUAL",
            dateTime: {
              date: "2026-07-02",
              localDateTime: "2026-07-02T00:00:00",
              offsetDateTime: "2026-07-02T00:00:00+00:00",
            },
          },
        },
      ],
      outgoingVehicle: {
        vesselName: "CMA CGM RIO GRANDE",
        voyageNumber: "0R10FE1MA",
      },
      visible: true,
    },
    {
      source: "REAL",
      reached: false,
      completed: false,
      labelIdentifier: "route-location.transit.sea",
      location: {
        locationCode: "EGPSD",
        countryCode: "EG",
        countryName: "EGYPT",
        internationalName: "Port Said",
      },
      locationMilestones: [
        {
          labelIdentifier: "location-milestone.transit.vehicle-arrived.sea",
          reached: false,
          achievementDateTime: {
            condition: "PLANNED",
            dateTime: {
              date: "2026-07-12",
              localDateTime: "2026-07-12T00:00:00",
            },
          },
        },
      ],
      outgoingVehicle: {
        vesselName: "CMA CGM COLUMBIA",
        voyageNumber: "0MXOTW1MA",
      },
      visible: true,
    },
    {
      source: "REAL",
      reached: false,
      completed: false,
      labelIdentifier: "route-location.arrival.sea",
      location: {
        locationCode: "SAJED",
        countryCode: "SA",
        countryName: "SAUDI ARABIA",
        internationalName: "Jeddah",
      },
      locationMilestones: [
        {
          labelIdentifier: "location-milestone.arrival.vehicle-arrived.sea",
          reached: false,
          achievementDateTime: {
            condition: "PLANNED",
            dateTime: {
              date: "2026-08-01",
              localDateTime: "2026-08-01T00:00:00",
            },
          },
        },
      ],
      visible: true,
    },
  ],
};

describe("selectKuehneCandidates", () => {
  it("prioriza o BL (reference.OBL) na consulta por BL", () => {
    const candidates = selectKuehneCandidates(
      blListFixture,
      "bl",
      "SK#606N000455SZ1",
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 522814459,
      kind: "reference.OBL",
    });
  });

  it("prioriza container (reference.CN) e descarta o embarque aéreo", () => {
    const candidates = selectKuehneCandidates(
      containerListFixture,
      "container",
      "TEST123456",
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      522814459, 525569072, 527138684,
    ]);
    expect(candidates[0]?.kind).toBe("reference.CN");
    expect(candidates[2]?.modeOfTransport).toBe("air");
  });

  it("devolve vazio para payload fora do formato", () => {
    expect(selectKuehneCandidates(null, "bl", "X")).toEqual([]);
    expect(selectKuehneCandidates({ totalResults: 0 }, "bl", "X")).toEqual([]);
  });
});

describe("kuehneEventStatus", () => {
  it("traduz os marcos do roteiro", () => {
    expect(
      kuehneEventStatus("location-milestone.departure.vehicle-departed.sea"),
    ).toBe("in_transit");
    expect(
      kuehneEventStatus("location-milestone.transit.vehicle-arrived.sea"),
    ).toBe("transshipment");
    expect(
      kuehneEventStatus("location-milestone.arrival.vehicle-arrived.sea"),
    ).toBe("arrived");
    expect(
      kuehneEventStatus("location-milestone.arrival.vehicle-discharged.sea"),
    ).toBe("discharged");
    expect(
      kuehneEventStatus(
        "location-milestone.destination-container-depot.container-gate-in-empty.sea",
      ),
    ).toBe("empty_returned");
    expect(
      kuehneEventStatus("location-milestone.origin.ready-for-pickup.sea"),
    ).toBe("pending");
  });

  it("descreve o marco com o local", () => {
    expect(
      kuehneMilestoneDescription(
        "location-milestone.departure.vehicle-departed.sea",
      ),
    ).toBe("Partida — no porto de embarque");
  });
});

describe("normalizeKuehneResponse", () => {
  it("monta o snapshot com timeline, navio e ETA", () => {
    const snapshot = normalizeKuehneResponse(
      {
        abstract: abstractFixture,
        content: validContentFixture,
        routing: routingFixture,
      },
      "TCKU7925277",
    );

    expect(snapshot.found).toBe(true);
    expect(snapshot.status).toBe("in_transit");
    expect(snapshot.eta).toBe("2026-08-01");
    expect(snapshot.vessel).toBe("CMA CGM RIO GRANDE");
    expect(snapshot.voyage).toBe("0R10FE1MA");
    expect(snapshot.containers).toEqual(["TCKU7925277"]);

    // Só a partida é fato consumado; transbordo e chegada são previsão.
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({
      eventAt: "2026-07-02T00:00:00.000Z",
      status: "in_transit",
      location: "Hamburg / DE",
      containerNumber: "TCKU7925277",
    });
    expect(snapshot.events[0]?.description).toContain("Partida");
  });

  it("marca arrived quando a chegada ao destino foi concluída", () => {
    const routing = {
      ...routingFixture,
      routeLocations: routingFixture.routeLocations.map((location) =>
        location.labelIdentifier === "route-location.arrival.sea"
          ? {
              ...location,
              reached: true,
              completed: true,
              locationMilestones: [
                {
                  labelIdentifier:
                    "location-milestone.arrival.vehicle-arrived.sea",
                  reached: true,
                  achievementDateTime: {
                    condition: "ACTUAL",
                    dateTime: { date: "2026-08-01" },
                  },
                  actualAchievementDateTime: {
                    condition: "ACTUAL",
                    dateTime: { date: "2026-08-01" },
                  },
                },
              ],
            }
          : location,
      ),
    };

    const snapshot = normalizeKuehneResponse({
      abstract: abstractFixture,
      routing,
    });

    expect(snapshot.status).toBe("arrived");
    expect(snapshot.eta).toBe("2026-08-01");
    expect(snapshot.events[0]?.status).toBe("arrived");
  });

  it("usa o estágio quando o portal ainda não tem marcos concluídos", () => {
    const snapshot = normalizeKuehneResponse({
      abstract: { ...abstractFixture, stage: "stage.in-transit" },
      routing: { modeOfTransport: "SEA", routeLocations: [] },
    });

    expect(snapshot.found).toBe(true);
    expect(snapshot.status).toBe("in_transit");
    expect(snapshot.events).toHaveLength(0);
  });

  it("descarta container fora do padrão ISO 6346", () => {
    const snapshot = normalizeKuehneResponse(
      {
        abstract: abstractFixture,
        content: contentFixture,
        routing: routingFixture,
      },
      "TEST123456",
    );

    expect(snapshot.found).toBe(true);
    expect(snapshot.containers).toEqual([]);
    expect(snapshot.events[0]?.containerNumber).toBeNull();
  });

  it("marca error quando nenhuma resposta está no formato esperado", () => {
    const snapshot = normalizeKuehneResponse({});

    expect(snapshot.found).toBe(false);
    expect(snapshot.status).toBe("error");
    expect(snapshot.notes).toContain("formato");
  });
});

describe("buildKuehneScrapeUrl", () => {
  it("monta o deep link do portal público preservando a pontuação", () => {
    expect(
      buildKuehneScrapeUrl({
        queryType: "bl",
        queryValue: "SK#606N000455SZ1",
      }),
    ).toBe(
      "https://mykn.kuehne-nagel.com/public-tracking/shipments?query=SK%23606N000455SZ1",
    );
  });

  it("devolve null para valor vazio", () => {
    expect(
      buildKuehneScrapeUrl({ queryType: "bl", queryValue: "  " }),
    ).toBeNull();
  });
});

const BASE_URL = "https://mykn.kuehne-nagel.com";

type FetchRoute = { status?: number; body?: unknown } | "network_error";

/** Stub do `fetch` roteado pelo caminho da API (sem rede nos testes). */
function mockKuehneFetch(routes: Record<string, FetchRoute>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace(BASE_URL, "");
    const route = routes[path];
    if (!route) return new Response("not found", { status: 404 });
    if (route === "network_error") throw new Error("offline");
    return new Response(JSON.stringify(route.body ?? null), {
      status: route.status ?? 200,
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("fetchKuehneTracking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const listPath = (query: string) =>
    `/public-tracking/internal/shipment-list?query=${encodeURIComponent(query)}`;
  const detailPath = (id: number, block: string) =>
    `/public-tracking/internal/shipments/${id}/${block}`;

  it("na busca por container prefere o embarque com timeline", async () => {
    // O container é reutilizado: o primeiro resultado é uma reserva antiga.
    const list = {
      totalResults: 2,
      searchResultsByType: [
        {
          kind: "reference.CN",
          numberOfResults: 2,
          shipments: [
            {
              id: 1,
              modeOfTransport: "sea",
              trackingNumber: "1076000001",
              stage: "stage.booked",
            },
            {
              id: 2,
              modeOfTransport: "sea",
              trackingNumber: "1076978651",
              stage: "stage.in-transit",
            },
          ],
        },
      ],
    };

    const fetchMock = mockKuehneFetch({
      [listPath("TCKU7925277")]: { body: list },
      [detailPath(1, "abstract")]: { body: { stage: "stage.booked" } },
      [detailPath(1, "content")]: {
        body: { container: [{ containerNumber: "TCKU7925277" }] },
      },
      [detailPath(1, "shipment-routing")]: {
        body: { modeOfTransport: "SEA", routeLocations: [] },
      },
      [detailPath(2, "abstract")]: { body: abstractFixture },
      [detailPath(2, "content")]: { body: validContentFixture },
      [detailPath(2, "shipment-routing")]: { body: routingFixture },
    });

    const result = await fetchKuehneTracking({
      queryType: "container",
      queryValue: "TCKU7925277",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.vessel).toBe("CMA CGM RIO GRANDE");
    expect(result.snapshot.eta).toBe("2026-08-01");
    expect(result.snapshot.events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("descarta embarque que não lista o container consultado", async () => {
    // Mesmo formato do número, outro equipamento: é outro embarque.
    mockKuehneFetch({
      [listPath("TCKU7925277")]: {
        body: {
          totalResults: 1,
          searchResultsByType: [
            {
              kind: "reference.CN",
              numberOfResults: 1,
              shipments: [
                {
                  id: 3,
                  modeOfTransport: "sea",
                  trackingNumber: "1076000003",
                  stage: "stage.in-transit",
                },
              ],
            },
          ],
        },
      },
      [detailPath(3, "abstract")]: { body: { stage: "stage.in-transit" } },
      [detailPath(3, "content")]: {
        body: { container: [{ containerNumber: "MSMU4775369" }] },
      },
      [detailPath(3, "shipment-routing")]: {
        body: { modeOfTransport: "SEA", routeLocations: [] },
      },
    });

    const result = await fetchKuehneTracking({
      queryType: "container",
      queryValue: "TCKU7925277",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.found).toBe(false);
    expect(result.snapshot.status).toBe("not_found");
  });

  it("aceita o BL do documento mesmo sem marcos concluídos", async () => {
    mockKuehneFetch({
      [listPath("SK#606N000455SZ1")]: { body: blListFixture },
      [detailPath(522814459, "abstract")]: {
        body: {
          primaryReference: "1076358717",
          modeOfTransport: "SEA",
          stage: "stage.booked",
        },
      },
      [detailPath(522814459, "content")]: {
        body: { container: [{ containerNumber: "GAOU7393528" }] },
      },
      [detailPath(522814459, "shipment-routing")]: {
        body: { modeOfTransport: "SEA", routeLocations: [] },
      },
    });

    const result = await fetchKuehneTracking({
      queryType: "bl",
      queryValue: "SK#606N000455SZ1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.found).toBe(true);
    expect(result.snapshot.status).toBe("pending");
    expect(result.snapshot.events).toHaveLength(0);
  });

  it("traduz bloqueio do portal (403) em código de erro", async () => {
    mockKuehneFetch({
      [listPath("TCKU7925277")]: { status: 403 },
    });

    const result = await fetchKuehneTracking({
      queryType: "container",
      queryValue: "TCKU7925277",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("kuehne_http_403");
    expect(result.httpStatus).toBe(403);
  });

  it("traduz falha de rede em código de erro", async () => {
    mockKuehneFetch({
      [listPath("TCKU7925277")]: "network_error",
    });

    const result = await fetchKuehneTracking({
      queryType: "container",
      queryValue: "TCKU7925277",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("kuehne_network_error");
    expect(result.errorMessage).toContain("offline");
  });

  it("devolve not_found quando a busca não retorna embarques", async () => {
    mockKuehneFetch({
      [listPath("TCKU7925277")]: {
        body: { totalResults: 0, searchResultsByType: [] },
      },
    });

    const result = await fetchKuehneTracking({
      queryType: "container",
      queryValue: "TCKU7925277",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.found).toBe(false);
    expect(result.snapshot.status).toBe("not_found");
  });

  it("rejeita consulta vazia sem chamar a rede", async () => {
    const fetchMock = mockKuehneFetch({});

    const result = await fetchKuehneTracking({
      queryType: "bl",
      queryValue: "  ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("kuehne_invalid_query");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
