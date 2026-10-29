import { describe, expect, it } from "vitest";
import {
  inferTrackingStatus,
  normalizeFirecrawlResult,
  parseTrackingDate,
} from "@/lib/tracking/normalize";

describe("parseTrackingDate", () => {
  it("interpreta ISO, DD/MM/AAAA e nomes de mês", () => {
    expect(parseTrackingDate("2026-10-12")).toBe("2026-10-12T00:00:00.000Z");
    expect(parseTrackingDate("12/10/2026 10:30")).toBe(
      "2026-10-12T10:30:00.000Z",
    );
    expect(parseTrackingDate("12 Jan 2026")).toBe("2026-01-12T00:00:00.000Z");
    expect(parseTrackingDate("Jan 12, 2026")).toBe("2026-01-12T00:00:00.000Z");
  });

  it("interpreta o formato da CMA CGM com dia da semana e AM/PM", () => {
    expect(parseTrackingDate("Thursday, 01-OCT-2026 08:00 AM")).toBe(
      "2026-10-01T08:00:00.000Z",
    );
    expect(parseTrackingDate("Mon 02-NOV-2026 01:00 PM")).toBe(
      "2026-11-02T13:00:00.000Z",
    );
  });

  it("interpreta o formato da Evergreen (MMM-DD-YYYY)", () => {
    expect(parseTrackingDate("OCT-27-2026")).toBe("2026-10-27T00:00:00.000Z");
    expect(parseTrackingDate("SEP-23-2026")).toBe("2026-09-23T00:00:00.000Z");
  });

  it("ignora o sufixo de fuso da COSCO (BRT)", () => {
    expect(parseTrackingDate("2026-09-24T14:43:49BRT")).toBe(
      "2026-09-24T14:43:49.000Z",
    );
  });

  it("devolve null para data inválida", () => {
    expect(parseTrackingDate("")).toBeNull();
    expect(parseTrackingDate("ontem")).toBeNull();
  });
});

describe("inferTrackingStatus", () => {
  it("reconhece eventos em português e inglês", () => {
    expect(inferTrackingStatus("Gate out")).toBe("in_transit");
    expect(inferTrackingStatus("Loaded on board")).toBe("in_transit");
    expect(inferTrackingStatus("Transshipment at Singapore")).toBe(
      "transshipment",
    );
    expect(inferTrackingStatus("Discharged")).toBe("discharged");
    expect(inferTrackingStatus("Delivered")).toBe("delivered");
    expect(inferTrackingStatus("Empty return")).toBe("empty_returned");
  });

  it("devolve null quando não reconhece", () => {
    expect(inferTrackingStatus("Documento emitido")).toBeNull();
  });

  it("não trata chegada planejada como chegada", () => {
    expect(inferTrackingStatus("Planned Vessel Arrival")).toBe("in_transit");
    expect(inferTrackingStatus("Vessel Departure")).toBe("in_transit");
  });
});

describe("normalizeFirecrawlResult", () => {
  it("normaliza, ordena e deduplica eventos", () => {
    const result = normalizeFirecrawlResult(
      {
        found: true,
        vessel: "MSC VESSEL",
        voyage: "V001",
        eta: "2026-11-05",
        containers: [
          {
            number: "CSQU3054383",
            status: "In transit",
            events: [
              {
                date: "10/10/2026",
                location: "Santos",
                description: "Gate out",
              },
              {
                date: "12/10/2026",
                location: "Santos",
                description: "Loaded on board",
              },
            ],
          },
          {
            number: "CSQU3054383",
            events: [
              {
                date: "12/10/2026",
                location: "Santos",
                description: "Loaded on board",
              },
            ],
          },
        ],
      },
      null,
    );

    expect(result.status).toBe("in_transit");
    expect(result.vessel).toBe("MSC VESSEL");
    expect(result.eta).toBe("2026-11-05");
    expect(result.containers).toEqual(["CSQU3054383"]);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.description).toBe("Loaded on board");
    expect(result.events[0]?.eventAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("usa o container da consulta quando a página não informa", () => {
    const result = normalizeFirecrawlResult(
      {
        found: true,
        containers: [
          {
            number: "",
            events: [{ date: "2026-10-10", description: "Gate out" }],
          },
        ],
      },
      "CSQU3054383",
    );

    expect(result.containers).toEqual(["CSQU3054383"]);
    expect(result.events[0]?.containerNumber).toBe("CSQU3054383");
  });

  it("corrige container com tipo colado (Maersk) e não marca chegada futura", () => {
    const result = normalizeFirecrawlResult(
      {
        found: true,
        vessel: "SAN NICOLAS MAERSK",
        voyage: "639W",
        eta: "14 Nov 2026",
        containers: [
          {
            number: "MMAU142149940",
            status: "Reefer High",
            events: [
              {
                date: "2026-11-14T16:00:00",
                location: "ITAPOA",
                description: "Vessel arrival",
              },
              {
                date: "2026-10-06T22:22:00",
                location: "SHANGHAI",
                description: "Vessel departure",
              },
            ],
          },
        ],
      },
      null,
    );

    expect(result.containers).toEqual(["MMAU1421499"]);
    expect(result.eta).toBe("2026-11-14");
    expect(result.status).toBe("in_transit");
  });

  it("aceita navio divergente (rollover/transbordo) e sinaliza a divergência", () => {
    const result = normalizeFirecrawlResult(
      {
        found: true,
        vessel: "CMA CGM SANTOS",
        voyage: "0TX9W1",
        eta: "2026-11-20",
        containers: [
          {
            number: "CMAU9481811",
            status: "In transit",
            events: [
              {
                date: "Thursday, 15-OCT-2026 08:00 AM",
                location: "Santos",
                description: "Vessel departure",
              },
            ],
          },
        ],
        notes: "Carga remanejada",
      },
      "CMAU9481811",
      { vessel: "CMA CGM ATLANTIC" },
    );

    expect(result.found).toBe(true);
    expect(result.status).toBe("in_transit");
    // O navio/viagem exibidos são os do portal; o BL fica intacto.
    expect(result.vessel).toBe("CMA CGM SANTOS");
    expect(result.voyage).toBe("0TX9W1");
    expect(result.eta).toBe("2026-11-20");
    expect(result.containers).toEqual(["CMAU9481811"]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.vessel).toBe("CMA CGM SANTOS");
    expect(result.vesselMismatch).toEqual({
      expected: "CMA CGM ATLANTIC",
      found: "CMA CGM SANTOS",
    });
    expect(result.notes).toContain("Navio no portal diferente do BL");
    expect(result.notes).toContain("Carga remanejada");
  });

  it("não sinaliza divergência quando o navio é o mesmo", () => {
    const result = normalizeFirecrawlResult(
      {
        found: true,
        vessel: "CMA CGM ATLANTIC",
        voyage: "SE3060W19",
        containers: [],
      },
      null,
      { vessel: "CMA CGM ATLANTIC" },
    );

    expect(result.vesselMismatch).toBeNull();
    expect(result.notes).toBeNull();
  });

  it("continua rejeitando container divergente mesmo com navio diferente", () => {
    const result = normalizeFirecrawlResult(
      {
        found: true,
        vessel: "CMA CGM SANTOS",
        containers: [{ number: "CSQU3054383", events: [] }],
      },
      "MMAU1421499",
      { vessel: "CMA CGM ATLANTIC" },
    );

    expect(result.found).toBe(false);
    expect(result.status).toBe("not_found");
    expect(result.notes).toContain("outro container");
    expect(result.vesselMismatch).toBeNull();
  });

  it("marca not_found quando a página não encontrou o número", () => {
    const result = normalizeFirecrawlResult(
      { found: false, containers: [] },
      null,
    );
    expect(result.status).toBe("not_found");
    expect(result.events).toHaveLength(0);
  });

  it("prioriza eventos quando a página ainda mostra um erro residual", () => {
    const result = normalizeFirecrawlResult(
      {
        found: false,
        containers: [
          {
            number: "CAIU9274323",
            events: [
              {
                date: "Thursday, 01-OCT-2026 08:00 AM",
                description: "Vessel Departure",
              },
              {
                date: "Monday, 02-NOV-2026 01:00 PM",
                description: "Planned Vessel Arrival",
              },
            ],
          },
        ],
      },
      null,
    );

    expect(result.found).toBe(true);
    expect(result.status).toBe("in_transit");
    expect(result.eta).toBe("2026-11-02");
  });

  it("marca error quando o payload não tem o formato esperado", () => {
    const result = normalizeFirecrawlResult(null, null);
    expect(result.status).toBe("error");
    expect(result.notes).toContain("formato");
  });
});
