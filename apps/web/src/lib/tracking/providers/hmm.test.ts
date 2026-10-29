import { describe, expect, it } from "vitest";
import {
  buildHmmActions,
  buildHmmScrapeUrl,
  HMM_WAIT_FOR_MS,
  hmmEventStatus,
  normalizeHmmResponse,
  splitHmmVesselVoyage,
} from "@/lib/tracking/providers/hmm";

function cell(value: string, className = "text"): string {
  return `<td><div class="${className}">${value}</div></td>`;
}

function eventRow(
  date: string,
  time: string,
  location: string,
  description: string,
  mode: string,
  estimated = false,
): string {
  return [
    `<tr class="clsMoves${estimated ? " hidden clsPreviousMoves" : ""}">`,
    cell(date, estimated ? "text blue" : "text"),
    cell(time),
    cell(location),
    cell(description),
    cell(mode),
    "</tr>",
  ].join("");
}

function route(
  origin: string,
  destination: string,
  arrivalColor: "red" | "blue",
) {
  return [
    '<div class="route-wrap">',
    '<div class="location">',
    `<div>${origin}</div>`,
    '<div class="text-nowrap" style="font-size: 15px">Departure at Origin</div>',
    '<div class="text-nowrap red" style="font-size: 15px">2026-05-18 20:57</div>',
    "</div>",
    '<div class="route-area"></div>',
    '<div class="location">',
    `<div>${destination}</div>`,
    '<div class="text-nowrap" style="font-size: 15px">Arrival at Destination</div>',
    `<div class="text-nowrap ${arrivalColor}" style="font-size: 15px">2026-07-22 15:14</div>`,
    "</div>",
    "</div>",
  ].join("");
}

function vesselMovement(rows: Array<[string, string, string, string]>): string {
  const header = [
    "<thead><tr>",
    "<th><div class='text'>Vessel / Voyage</div></th>",
    "<th><div class='text'>Route</div></th>",
    "<th><div class='text'>Loading Port</div></th>",
    "<th><div class='text'>Departure</div></th>",
    "<th><div class='text'>Discharging Port</div></th>",
    "<th><div class='text'>Arrival</div></th>",
    "</tr></thead>",
  ].join("");
  const body = rows
    .map(([vesselVoyage, loadingPort, dischargingPort, arrival]) =>
      [
        "<tr>",
        cell(vesselVoyage),
        cell("FL2"),
        cell(loadingPort),
        cell("2026-06-09 16:59"),
        cell(dischargingPort),
        cell(arrival),
        "</tr>",
      ].join(""),
    )
    .join("");
  return [
    '<div class="tab-inner">',
    '<div class="tab-title">Vessel Movement</div>',
    `<table>${header}<tbody>${body}</tbody></table>`,
    "</div>",
    '<div class="tab-title">Customs Status</div>',
  ].join("");
}

function containerRow(bl: string, container: string, index: number): string {
  return [
    "<tr>",
    cell(String(index)),
    `<td><div class="text"><div class="click" id="cntrId${index}" onclick="cntrSelect(&#39;${bl}&#39;,&#39;bl&#39;,&#39;${container}&#39;, &#39;${index}&#39;)">${container}</div></div></td>`,
    cell("DC"),
    cell("DC/4H"),
    cell("26200"),
    cell(bl),
    cell("Import Empty Container Returned"),
    cell("2026-07-28 08:56"),
    "</tr>",
  ].join("");
}

/** Fragmento equivalente ao HTML real devolvido pela HMM para o BL. */
function blFixture(
  options: {
    arrivalColor?: "red" | "blue";
    containers?: Array<[string, string]>;
  } = {},
): string {
  const arrivalColor = options.arrivalColor ?? "red";
  const containers = options.containers ?? [["TSNM72593800", "KOCU4320185"]];
  const events = [
    eventRow(
      "2026-07-28",
      "08:56",
      "ITAPOA, BRAZIL",
      "Import Empty Container Returned",
      "Truck",
    ),
    eventRow(
      "2026-07-25",
      "08:10",
      "ITAPOA, BRAZIL",
      "Import Truck Gate Out from Terminal",
      "Truck",
      true,
    ),
    eventRow(
      "2026-07-22",
      "15:14",
      "ITAPOA, BRAZIL",
      "Vessel Discharged at POD",
      "ONE PREMIUM 0092W",
    ),
    eventRow(
      "2026-07-21",
      "20:58",
      "ITAPOA, BRAZIL",
      "Vessel Berthing at POD",
      "ONE PREMIUM 0092W",
    ),
    eventRow(
      "2026-06-09",
      "16:59",
      "BUSAN, KOREA",
      "Vessel Departure from T/S Port",
      "ONE PREMIUM 0092W",
    ),
    eventRow(
      "2026-06-02",
      "19:20",
      "BUSAN, KOREA",
      "Vessel Berthing at T/S Port",
      "ONE MANCHESTER 0046E",
    ),
    eventRow(
      "2026-05-25",
      "08:00",
      "XINGANG, TIANJIN, CHINA",
      "Vessel Loading at POL",
      "ONE MANCHESTER 0046E",
    ),
    eventRow(
      "2026-05-18",
      "20:57",
      "XINGANG, TIANJIN, CHINA",
      "Export Empty Container Released",
      "Truck",
    ),
  ].join("\n");

  return [
    '<div class="tab-outer" id="trackingInfomationDateResultTable">',
    '<input type="hidden" id="thisBl" value="TSNM72593800" />',
    '<input type="hidden" id="thisCntr" value="KOCU4320185" />',
    route("XINGANG, TIANJIN, CHINA", "ITAPOA, BRAZIL", arrivalColor),
    '<div class="tab-inner"><div class="tab-title">Shipment History</div>',
    `<table><tbody>${events}</tbody></table></div>`,
    vesselMovement([
      [
        "ONE MANCHESTER 0046E",
        "XINGANG, TIANJIN, CHINA",
        "BUSAN, KOREA",
        "2026-06-02 19:20",
      ],
      [
        "ONE PREMIUM 0092W",
        "BUSAN, KOREA",
        "ITAPOA, BRAZIL",
        "2026-07-21 20:58",
      ],
    ]),
    '<div class="tab-inner"><div class="tab-title">Container Information</div><table><tbody>',
    containers
      .map(([bl, container], index) => containerRow(bl, container, index + 1))
      .join(""),
    "</tbody></table></div>",
    "</div>",
  ].join("\n");
}

const NOT_FOUND_FIXTURE = [
  '<div class="tab-outer" id="trackingInfomationDateResultTable">',
  '<input type="hidden" id="searchType" value="" />',
  '<div class="tab-inner">',
  '<div class="tab-title-wrap">',
  '<div class="tab-title">B/L no. is invalid. Please try again with the correct B/L no.</div>',
  "</div>",
  "</div>",
  "</div>",
].join("\n");

describe("fallback Firecrawl", () => {
  it("aponta para a página de track & trace", () => {
    expect(
      buildHmmScrapeUrl({ queryType: "bl", queryValue: "TSNM72593800" }),
    ).toBe(
      "https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do",
    );
    expect(buildHmmScrapeUrl({ queryType: "bl", queryValue: "  " })).toBeNull();
  });

  it("preenche o campo certo para BL, container e booking", () => {
    const bl = buildHmmActions({
      queryType: "bl",
      queryValue: "tsnm 72593800",
    });
    const cntr = buildHmmActions({
      queryType: "container",
      queryValue: "KOCU4320185",
    });
    const bkg = buildHmmActions({
      queryType: "booking",
      queryValue: "TSNM72593800",
    });

    expect(bl).toBeDefined();
    expect(bl?.[1]).toEqual({
      type: "click",
      selector: 'input[name="srchBlNo1"]',
    });
    // O valor é normalizado antes de digitar.
    expect(bl?.[2]).toEqual({ type: "write", text: "TSNM72593800" });
    expect(cntr?.[1]).toEqual({
      type: "click",
      selector: 'input[name="srchCntrNo1"]',
    });
    expect(bkg?.[1]).toEqual({
      type: "click",
      selector: 'input[name="srchBkgNo1"]',
    });
    expect(bl?.[4]).toEqual({
      type: "click",
      selector: 'button[onclick="search()"]',
    });
    expect(bl?.at(-1)).toEqual({
      type: "wait",
      milliseconds: HMM_WAIT_FOR_MS,
    });
  });

  it("não monta ações sem número", () => {
    expect(
      buildHmmActions({ queryType: "bl", queryValue: "   " }),
    ).toBeUndefined();
  });
});

describe("splitHmmVesselVoyage", () => {
  it("separa navio e viagem no formato da HMM", () => {
    expect(splitHmmVesselVoyage("ONE PREMIUM 0092W")).toEqual({
      vessel: "ONE PREMIUM",
      voyage: "0092W",
    });
    expect(splitHmmVesselVoyage("ONE MANCHESTER 0046E")).toEqual({
      vessel: "ONE MANCHESTER",
      voyage: "0046E",
    });
    expect(splitHmmVesselVoyage("[FL2] ONE PREMIUM 0092W")).toEqual({
      vessel: "ONE PREMIUM",
      voyage: "0092W",
    });
  });

  it("ignora meios de transporte terrestre e valores vazios", () => {
    expect(splitHmmVesselVoyage("Truck")).toBeNull();
    expect(splitHmmVesselVoyage("Rail")).toBeNull();
    expect(splitHmmVesselVoyage("")).toBeNull();
    expect(splitHmmVesselVoyage(null)).toBeNull();
    expect(splitHmmVesselVoyage("HMM JUNIPER")).toBeNull();
  });
});

describe("hmmEventStatus", () => {
  it("traduz as descrições do track & trace da HMM", () => {
    expect(hmmEventStatus("Import Empty Container Returned")).toBe(
      "empty_returned",
    );
    expect(hmmEventStatus("Import Truck Gate Out from Terminal")).toBe(
      "in_transit",
    );
    expect(hmmEventStatus("Vessel Discharged at POD")).toBe("discharged");
    expect(hmmEventStatus("Vessel Berthing at POD")).toBe("arrived");
    expect(hmmEventStatus("Vessel Arrival at POD")).toBe("arrived");
    expect(hmmEventStatus("Vessel Departure from T/S Port")).toBe("in_transit");
    expect(hmmEventStatus("Export Empty Container Released")).toBe("pending");
    expect(hmmEventStatus("Truck Gate In to T/S Terminal")).toBe("in_transit");
    expect(hmmEventStatus("Delivered")).toBe("delivered");
  });
});

describe("normalizeHmmResponse", () => {
  it("mapeia navio oceânico, ETA, container e timeline", () => {
    const snapshot = normalizeHmmResponse(blFixture());

    expect(snapshot.found).toBe(true);
    expect(snapshot.containers).toEqual(["KOCU4320185"]);
    // Última perna do Vessel Movement (POD), não o feeder de transbordo.
    expect(snapshot.vessel).toBe("ONE PREMIUM");
    expect(snapshot.voyage).toBe("0092W");
    expect(snapshot.eta).toBe("2026-07-22");
    expect(snapshot.status).toBe("empty_returned");
    expect(snapshot.events).toHaveLength(8);
    expect(snapshot.events[0]?.eventAt).toBe("2026-07-28T08:56:00.000Z");
    expect(snapshot.events[0]?.location).toBe("ITAPOA, BRAZIL");
    expect(snapshot.events[0]?.containerNumber).toBe("KOCU4320185");
    expect(snapshot.events[0]?.status).toBe("empty_returned");
  });

  it("mantém o navio de cada evento separado do navio oceânico", () => {
    const snapshot = normalizeHmmResponse(blFixture());
    const loading = snapshot.events.find(
      (event) => event.description === "Vessel Loading at POL",
    );
    expect(loading?.vessel).toBe("ONE MANCHESTER");
    expect(loading?.voyage).toBe("0046E");
    const gate = snapshot.events.find(
      (event) => event.description === "Import Empty Container Returned",
    );
    expect(gate?.vessel).toBeNull();
  });

  it("trata evento azul (previsão) como em trânsito", () => {
    const snapshot = normalizeHmmResponse(
      blFixture({ arrivalColor: "blue" }).replace(
        /<tr class="clsMoves([^"]*)">(<td><div class="text)">2026-07-22/,
        '<tr class="clsMoves$1">$2 blue">2026-07-22',
      ),
    );

    expect(snapshot.eta).toBe("2026-07-22");
    // O evento mais recente continua sendo o vazio devolvido (fato).
    expect(snapshot.status).toBe("empty_returned");
  });

  it("não atribui container único do BL a eventos de vários containers", () => {
    const snapshot = normalizeHmmResponse(
      blFixture({
        containers: [
          ["TSNM72593800", "KOCU4320185"],
          ["TSNM72593800", "TIIU4085593"],
        ],
      }),
    );

    expect(snapshot.containers).toEqual(["KOCU4320185", "TIIU4085593"]);
    expect(
      snapshot.events.every((event) => event.containerNumber === null),
    ).toBe(true);
  });

  it("usa o container consultado como dono dos eventos", () => {
    const snapshot = normalizeHmmResponse(
      blFixture({
        containers: [
          ["TSNM72593800", "KOCU4320185"],
          ["TSNM72593800", "TIIU4085593"],
        ],
      }),
      { fallbackContainer: "KOCU4320185" },
    );

    expect(snapshot.events[0]?.containerNumber).toBe("KOCU4320185");
  });

  it("marca not_found quando a HMM recusa o número", () => {
    const snapshot = normalizeHmmResponse(NOT_FOUND_FIXTURE);

    expect(snapshot.found).toBe(false);
    expect(snapshot.status).toBe("not_found");
    expect(snapshot.notes).toContain("B/L no. is invalid");
    expect(snapshot.events).toHaveLength(0);
  });

  it("mantém pending quando só há container, sem histórico", () => {
    const snapshot = normalizeHmmResponse(
      [
        route("XINGANG, TIANJIN, CHINA", "ITAPOA, BRAZIL", "blue"),
        vesselMovement([
          [
            "ONE PREMIUM 0092W",
            "BUSAN, KOREA",
            "ITAPOA, BRAZIL",
            "2026-07-21 20:58",
          ],
        ]),
        containerRow("TSNM72593800", "KOCU4320185", 1),
      ].join("\n"),
    );

    expect(snapshot.found).toBe(true);
    expect(snapshot.status).toBe("pending");
    expect(snapshot.vessel).toBe("ONE PREMIUM");
    expect(snapshot.eta).toBe("2026-07-22");
    expect(snapshot.events).toHaveLength(0);
  });

  it("marca error quando a resposta vem vazia", () => {
    const snapshot = normalizeHmmResponse("");

    expect(snapshot.found).toBe(false);
    expect(snapshot.status).toBe("error");
  });
});
