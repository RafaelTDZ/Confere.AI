import { describe, expect, it } from "vitest";
import {
  buildOneScrapeUrl,
  normalizeOneResponse,
  oneEventStatus,
} from "@/lib/tracking/providers/one";

/** Resposta real da busca (BL ONEYSZPGC3008300 → booking SZPGC3008300). */
const searchFixture = {
  status: 200,
  code: 1,
  message: "Success",
  total: 1,
  data: [
    {
      bookingNo: "SZPGC3008300",
      bookingNoShow: "SZPGC3008300",
      containerNo: "TCKU7925277",
      containerTypeSize: "40'DRY HC.",
      weight: "19,980.000 KGS",
      copNo: "CSZP6512939629",
      socFlag: false,
      latestEvent: {
        eventName: "Empty Container Returned from Customer",
        locationName: "ITAPOA",
        date: "2026-08-01T11:23:00.000Z",
      },
      place: {
        yardCode: "BRIOA38",
        yardName: "VMG TRANSPORTE E LOGISTICA LTDA",
        locationName: "ITAPOA",
      },
      por: {
        code: "CNSHK",
        locationName: "SHEKOU, GUANGDONG",
        countryName: "CHINA",
      },
      pod: { code: "BRIOA", locationName: "ITAPOA", countryName: "BRAZIL" },
      cargoEvents: [
        {
          matrixId: "E061",
          locationName: "SHEKOU, GUANGDONG",
          date: "2026-06-13T22:35:00.000Z",
          trigger: "ACTUAL",
        },
      ],
      vesselVoyage: {
        vesselCode: "OMUT",
        vesselName: "ONE PREMIUM",
        voyageNo: "0092",
        directionCode: "W",
        inboundConsortiumVoyage: "092W",
        outboundConsortiumVoyage: "092W",
      },
    },
  ],
};

/** Timeline real do `cop-events` para o container TCKU7925277. */
const copEventsFixture = {
  status: 200,
  code: 1,
  message: "Success",
  data: [
    {
      eventName: "Empty Container Release to Shipper",
      eventDate: "2026-06-03T06:03:00.000Z",
      eventLocalPortDate: "2026-06-03T14:03:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E012",
      location: {
        code: "CNSHK",
        locationName: "SHEKOU, GUANGDONG",
        countryName: "CHINA",
      },
    },
    {
      eventName: "Gate In to Outbound Terminal",
      eventDate: "2026-06-05T05:40:00.000Z",
      eventLocalPortDate: "2026-06-05T13:40:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E040",
      location: {
        code: "CNSHK",
        locationName: "SHEKOU, GUANGDONG",
        countryName: "CHINA",
      },
    },
    {
      eventName: "Loaded on Vessel at Port of Loading",
      eventDate: "2026-06-13T07:11:00.000Z",
      eventLocalPortDate: "2026-06-13T15:11:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E058",
      location: {
        code: "CNSHK",
        locationName: "SHEKOU, GUANGDONG",
        countryName: "CHINA",
      },
      vessel: {
        code: "YDIT",
        name: "YM MODERATION",
        voyNo: "0083",
        dirCode: "W",
      },
      edhVessel: {
        code: "YDIT",
        name: "YM MODERATION",
        voyNo: "0083",
        inboundConsortiumVoyage: "083W",
        outboundConsortiumVoyage: "083W",
      },
    },
    {
      eventName: "Vessel Departure from Port of Loading",
      eventDate: "2026-06-13T22:35:00.000Z",
      eventLocalPortDate: "2026-06-14T06:35:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E061",
      location: {
        code: "CNSHK",
        locationName: "SHEKOU, GUANGDONG",
        countryName: "CHINA",
      },
    },
    {
      eventName: "Vessel Arrival at T/S Port",
      eventDate: "2026-06-19T10:20:00.000Z",
      eventLocalPortDate: "2026-06-19T18:20:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E062",
      location: {
        code: "SGSIN",
        locationName: "SINGAPORE",
        countryName: "SINGAPORE",
      },
    },
    {
      eventName: "Unloaded from Vessel at Transshipment Port",
      eventDate: "2026-06-20T00:07:00.000Z",
      eventLocalPortDate: "2026-06-20T08:07:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E066",
      location: {
        code: "SGSIN",
        locationName: "SINGAPORE",
        countryName: "SINGAPORE",
      },
    },
    {
      eventName: "Loaded on Vessel at Transshipment Port",
      eventDate: "2026-06-26T11:01:00.000Z",
      eventLocalPortDate: "2026-06-26T19:01:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E068",
      location: {
        code: "SGSIN",
        locationName: "SINGAPORE",
        countryName: "SINGAPORE",
      },
      vessel: {
        code: "OMUT",
        name: "ONE PREMIUM",
        voyNo: "0092",
        dirCode: "W",
      },
      edhVessel: {
        code: "OMUT",
        name: "ONE PREMIUM",
        voyNo: "0092",
        inboundConsortiumVoyage: "092W",
        outboundConsortiumVoyage: "092W",
      },
    },
    {
      eventName: "Departure from Transshipment Port",
      eventDate: "2026-06-27T00:00:00.000Z",
      eventLocalPortDate: "2026-06-27T08:00:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E070",
      location: {
        code: "SGSIN",
        locationName: "SINGAPORE",
        countryName: "SINGAPORE",
      },
    },
    {
      eventName: "Vessel Arrival at Port of Discharge",
      eventDate: "2026-07-21T23:54:00.000Z",
      eventLocalPortDate: "2026-07-21T20:54:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E089",
      location: {
        code: "BRIOA",
        locationName: "ITAPOA",
        countryName: "BRAZIL",
      },
    },
    {
      eventName: "Unloaded from Vessel at Port of Discharging",
      eventDate: "2026-07-22T09:04:00.000Z",
      eventLocalPortDate: "2026-07-22T06:04:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E105",
      location: {
        code: "BRIOA",
        locationName: "ITAPOA",
        countryName: "BRAZIL",
      },
    },
    {
      eventName:
        "Gate Out from Inbound Terminal for Delivery to Consignee (or Port Shuttle)",
      eventDate: "2026-07-30T16:20:00.000Z",
      eventLocalPortDate: "2026-07-30T13:20:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E118",
      location: {
        code: "BRIOA",
        locationName: "ITAPOA",
        countryName: "BRAZIL",
      },
    },
    {
      eventName: "Empty Container Returned from Customer",
      eventDate: "2026-08-01T14:23:00.000Z",
      eventLocalPortDate: "2026-08-01T11:23:00.000Z",
      triggerType: "ACTUAL",
      matrixId: "E136",
      location: {
        code: "BRIOA",
        locationName: "ITAPOA",
        countryName: "BRAZIL",
      },
    },
  ],
};

const copPayloads = [
  { containerNumber: "TCKU7925277", payload: copEventsFixture },
];

describe("buildOneScrapeUrl", () => {
  it("monta o deep link do BL com o código B", () => {
    const url = buildOneScrapeUrl({
      queryType: "bl",
      queryValue: "ONEYSZPGC3008300",
    });
    expect(url).toBe(
      "https://www.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=ONEYSZPGC3008300&trakNoTpCdParam=B",
    );
  });

  it("monta o deep link do container com o código C", () => {
    const url = buildOneScrapeUrl({
      queryType: "container",
      queryValue: "tcku7925277",
    });
    expect(url).toContain("trakNoParam=TCKU7925277");
    expect(url).toContain("trakNoTpCdParam=C");
  });

  it("devolve null sem número", () => {
    expect(buildOneScrapeUrl({ queryType: "bl", queryValue: "  " })).toBeNull();
  });
});

describe("oneEventStatus", () => {
  it("traduz os eventos reais do BL", () => {
    expect(oneEventStatus("Empty Container Release to Shipper")).toBe(
      "pending",
    );
    expect(oneEventStatus("Gate In to Outbound Terminal")).toBe("pending");
    expect(oneEventStatus("Loaded on Vessel at Port of Loading")).toBe(
      "in_transit",
    );
    expect(oneEventStatus("Vessel Departure from Port of Loading")).toBe(
      "in_transit",
    );
    expect(oneEventStatus("Vessel Arrival at T/S Port")).toBe("transshipment");
    expect(oneEventStatus("Unloaded from Vessel at Transshipment Port")).toBe(
      "transshipment",
    );
    expect(oneEventStatus("Loaded on Vessel at Transshipment Port")).toBe(
      "transshipment",
    );
    expect(oneEventStatus("Departure from Transshipment Port")).toBe(
      "in_transit",
    );
    expect(oneEventStatus("Vessel Arrival at Port of Discharge")).toBe(
      "arrived",
    );
    expect(oneEventStatus("Unloaded from Vessel at Port of Discharging")).toBe(
      "discharged",
    );
    expect(oneEventStatus("Empty Container Returned from Customer")).toBe(
      "empty_returned",
    );
  });

  it("previsão nunca vira chegada/descarga concluída", () => {
    expect(
      oneEventStatus("Vessel Arrival at Port of Discharge", "ESTIMATE"),
    ).toBe("in_transit");
    expect(
      oneEventStatus("Unloaded from Vessel at Port of Discharging", "PLANNED"),
    ).toBe("in_transit");
  });
});

describe("normalizeOneResponse", () => {
  it("mapeia navio do POL, ETA, containers e a timeline completa", () => {
    const snapshot = normalizeOneResponse(searchFixture, null, copPayloads);

    expect(snapshot.found).toBe(true);
    expect(snapshot.containers).toEqual(["TCKU7925277"]);
    expect(snapshot.vessel).toBe("YM MODERATION");
    expect(snapshot.voyage).toBe("083W");
    expect(snapshot.eta).toBe("2026-07-21");
    expect(snapshot.status).toBe("empty_returned");
    expect(snapshot.events).toHaveLength(12);
    expect(snapshot.events[0]?.eventAt).toBe("2026-08-01T14:23:00.000Z");
    expect(snapshot.events[0]?.location).toBe("ITAPOA");
    expect(snapshot.events[0]?.containerNumber).toBe("TCKU7925277");
    expect(
      new Set(snapshot.events.map((event) => event.fingerprint)).size,
    ).toBe(12);
    expect(snapshot.notes).toBe("Transbordo em SINGAPORE no ONE PREMIUM 092W");
  });

  it("mantém o navio/viagem de cada perna no evento", () => {
    const snapshot = normalizeOneResponse(searchFixture, null, copPayloads);
    const loadPol = snapshot.events.find((event) =>
      /loaded on vessel at port of loading/i.test(event.description),
    );
    const loadTs = snapshot.events.find((event) =>
      /loaded on vessel at transshipment port/i.test(event.description),
    );

    expect(loadPol?.vessel).toBe("YM MODERATION");
    expect(loadPol?.voyage).toBe("083W");
    expect(loadTs?.vessel).toBe("ONE PREMIUM");
    expect(loadTs?.voyage).toBe("092W");
  });

  it("usa o cabeçalho da busca quando não há timeline detalhada", () => {
    const snapshot = normalizeOneResponse(searchFixture, "TCKU7925277");

    expect(snapshot.found).toBe(true);
    // O status sai do único evento resumido (latestEvent).
    expect(snapshot.status).toBe("empty_returned");
    expect(snapshot.events).toHaveLength(1);
    // Sem evento de embarque, o navio vem do cabeçalho (ONE PREMIUM / 092W).
    expect(snapshot.vessel).toBe("ONE PREMIUM");
    expect(snapshot.voyage).toBe("092W");
  });

  it("marca not_found quando a busca não devolve linhas", () => {
    const snapshot = normalizeOneResponse({ status: 200, code: 1 }, null);

    expect(snapshot.found).toBe(false);
    expect(snapshot.status).toBe("not_found");
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.notes).toContain("Sem resultado");
  });

  it("marca error quando o payload é inválido", () => {
    const snapshot = normalizeOneResponse(null, null);

    expect(snapshot.found).toBe(false);
    expect(snapshot.status).toBe("error");
    expect(snapshot.notes).toContain("formato");
  });

  it("aceita previsão de chegada como ETA sem marcar arrived", () => {
    const cop = {
      status: 200,
      code: 1,
      data: [
        {
          eventName: "Loaded on Vessel at Port of Loading",
          eventDate: "2026-06-13T07:11:00.000Z",
          triggerType: "ACTUAL",
          location: { locationName: "SHEKOU, GUANGDONG" },
          vessel: { name: "YM MODERATION", voyNo: "0083" },
          edhVessel: { inboundConsortiumVoyage: "083W" },
        },
        {
          eventName: "Vessel Arrival at Port of Discharge",
          eventDate: "2026-11-02T10:00:00.000Z",
          triggerType: "ESTIMATE",
          location: { locationName: "ITAPOA" },
        },
      ],
    };

    const snapshot = normalizeOneResponse(searchFixture, null, [
      { containerNumber: "TCKU7925277", payload: cop },
    ]);

    expect(snapshot.status).toBe("in_transit");
    expect(snapshot.eta).toBe("2026-11-02");
  });
});
