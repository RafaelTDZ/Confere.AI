import { describe, expect, it } from "vitest";
import {
  mscEventStatus,
  normalizeMscResponse,
} from "@/lib/tracking/providers/msc";

const event = (
  order: number,
  date: string,
  location: string,
  description: string,
  detail: string[],
) => ({ Order: order, Date: date, Location: location, Description: description, Detail: detail });

const fixture = {
  IsSuccess: true,
  Data: {
    TrackingType: "Container",
    BillOfLadings: [
      {
        BillOfLadingNumber: "MEDUADL29358",
        GeneralTrackingInfo: {
          ShippedFrom: "QINGDAO, CN",
          ShippedTo: "ITAPOA, BR",
          PortOfLoad: "QINGDAO, CN",
          PortOfDischarge: "ITAPOA, BR",
        },
        Delivered: false,
        ContainersInfo: [
          {
            ContainerNumber: "MSMU4775369",
            ContainerType: "40' HIGH CUBE",
            PodEtaDate: "01/11/2026",
            LatestMove: "RIO DE JANEIRO, BR",
            Delivered: false,
            Events: [
              event(5, "01/11/2026", "ITAPOA, BR", "Estimated Time of Arrival", [
                "MSC CATERINA",
                "MM644R",
              ]),
              event(4, "27/10/2026", "RIO DE JANEIRO, BR", "Full Intended Transshipment", [
                "MSC CATERINA",
                "MM640A",
              ]),
              event(3, "13/10/2026", "RIO DE JANEIRO, BR", "Full Transshipment Discharged", [
                "MSC STELLA M X",
                "QI633A",
              ]),
              event(2, "12/08/2026", "QINGDAO, CN", "Export Loaded on Vessel", [
                "MSC STELLA M X",
                "QI633A",
              ]),
              event(1, "11/08/2026", "QINGDAO, CN", "Export received at CY", ["LADEN"]),
              event(0, "05/08/2026", "QINGDAO, CN", "Empty to Shipper", ["EMPTY"]),
            ],
          },
          {
            ContainerNumber: "TIIU4085593",
            PodEtaDate: "01/11/2026",
            Delivered: false,
            Events: [
              event(2, "12/08/2026", "QINGDAO, CN", "Export Loaded on Vessel", [
                "MSC STELLA M X",
                "QI633A",
              ]),
              event(1, "11/08/2026", "QINGDAO, CN", "Export received at CY", ["LADEN"]),
            ],
          },
        ],
      },
    ],
  },
};

describe("mscEventStatus", () => {
  it("traduz os eventos da MSC", () => {
    expect(mscEventStatus("Estimated Time of Arrival")).toBe("in_transit");
    expect(mscEventStatus("Full Intended Transshipment")).toBe("transshipment");
    expect(mscEventStatus("Full Transshipment Discharged")).toBe(
      "transshipment",
    );
    expect(mscEventStatus("Export Loaded on Vessel")).toBe("in_transit");
    expect(mscEventStatus("Export received at CY")).toBe("pending");
    expect(mscEventStatus("Delivered")).toBe("delivered");
  });
});

describe("normalizeMscResponse", () => {
  it("mapeia containers, navio oceânico, ETA e timeline", () => {
    const snapshot = normalizeMscResponse(fixture, null);

    expect(snapshot.found).toBe(true);
    expect(snapshot.containers).toEqual(["MSMU4775369", "TIIU4085593"]);
    expect(snapshot.vessel).toBe("MSC STELLA M X");
    expect(snapshot.voyage).toBe("QI633A");
    expect(snapshot.eta).toBe("2026-11-01");
    expect(snapshot.status).toBe("in_transit");
    expect(snapshot.events).toHaveLength(8);
    expect(snapshot.events[0]?.eventAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("marca not_found quando a MSC não reconhece o número", () => {
    const snapshot = normalizeMscResponse(
      {
        IsSuccess: false,
        Data:
          "No results found for this Bill of Lading number. Please recheck that the number is complete and correct and in the B/L format.",
      },
      "PLIQD4H06868",
    );
    expect(snapshot.status).toBe("not_found");
    expect(snapshot.notes).toContain("No results found");
    expect(snapshot.events).toHaveLength(0);
  });

  it("marca error quando o payload é inválido", () => {
    const snapshot = normalizeMscResponse(null, null);
    expect(snapshot.status).toBe("error");
  });
});
