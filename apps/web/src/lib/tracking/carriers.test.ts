import { describe, expect, it } from "vitest";
import {
  buildCarrierDeepLink,
  CARRIERS,
  carrierFromContainerPrefix,
  carrierSupportsContainer,
  detectCarrier,
  inferCarrier,
} from "@/lib/tracking/carriers";

describe("detectCarrier", () => {
  it("reconhece os armadores suportados", () => {
    expect(detectCarrier("MAERSK LINE")).toBe("maersk");
    expect(detectCarrier("MSC Mediterranean Shipping Company")).toBe("msc");
    expect(detectCarrier("CMA CGM")).toBe("cma");
    expect(detectCarrier("Hapag-Lloyd AG")).toBe("hapag");
    expect(detectCarrier("COSCO SHIPPING Lines")).toBe("cosco");
    expect(detectCarrier("EVERGREEN LINE")).toBe("evergreen");
    expect(detectCarrier("Evergreen Marine Corp")).toBe("evergreen");
    expect(detectCarrier("OOCL")).toBe("oocl");
    expect(detectCarrier("Orient Overseas Container Line")).toBe("oocl");
    expect(detectCarrier("HMM")).toBe("hmm");
    expect(detectCarrier("Hyundai Merchant Marine")).toBe("hmm");
    expect(detectCarrier("ONE")).toBe("one");
    expect(detectCarrier("Ocean Network Express")).toBe("one");
    expect(detectCarrier("Kuehne + Nagel Ltd.")).toBe("kuehne");
    expect(detectCarrier("KUEHNE-NAGEL")).toBe("kuehne");
    // Marca NVOCC da K+N (BL de casa da carga consolidada).
    expect(detectCarrier("Blue Anchor Line")).toBe("kuehne");
  });

  it("usa unknown quando não reconhece", () => {
    expect(detectCarrier("Yang Ming")).toBe("unknown");
    expect(detectCarrier(null)).toBe("unknown");
  });

  it("infere Hapag por container HLBU quando o BL é de forwarder", () => {
    expect(
      inferCarrier("YQN South-Logistics", ["SEGU9104520", "HLBU9334723"]),
    ).toBe("hapag");
    expect(inferCarrier("MSC", ["HLBU9334723"])).toBe("msc");
    expect(inferCarrier("YQN South-Logistics", ["SEGU9104520"])).toBe(
      "unknown",
    );
  });

  it("infere o armador pelo navio quando o BL é de forwarder", () => {
    expect(
      inferCarrier("LX Pantos Logistics", ["TCNU2640912"], "CMA CGM KRYPTON"),
    ).toBe("cma");
    expect(inferCarrier(null, [], "ONE PREMIUM")).toBe("one");
    expect(inferCarrier(null, [], "SAN NICOLAS MAERSK")).toBe("maersk");
    expect(inferCarrier("YQN", ["HLBU9334723"], "NAVEGANTES EXPRESS")).toBe(
      "hapag",
    );
  });

  it("infere MSC pelos containers quando o navio não traz a marca", () => {
    // OYH142: BL de casa da LX Pantos e navio `LE HAVRE` (MSC sem o prefixo
    // no nome) — só os containers MSGU identificam o armador.
    expect(
      inferCarrier(
        "LX PANTOS LOGISTICS (QINGDAO) CO.,LTD.",
        ["TXTU4077041", "MSGU6161889", "MSGU6163536"],
        "LE HAVRE",
      ),
    ).toBe("msc");
  });

  it("ignora containers de locadora na inferência por prefixo", () => {
    // TXTU (Textainer), TGHU (Triton) e SEGU (Seacastle) são do dono do
    // equipamento, não do armador: sem outra pista o armador segue `unknown`.
    expect(
      inferCarrier(
        "LX Pantos Logistics",
        ["TXTU4077041", "TGHU6251317", "SEGU9104520"],
        "LE HAVRE",
      ),
    ).toBe("unknown");
    expect(carrierFromContainerPrefix("TXTU4077041")).toBeNull();
  });
});

describe("CARRIERS", () => {
  it("mantém a OOCL em link + evento manual (captcha CargoSmart)", () => {
    expect(CARRIERS.oocl.strategy).toBe("link");
  });

  it("usa a API interna da HMM (http, 0 créditos)", () => {
    expect(CARRIERS.hmm.strategy).toBe("http");
  });

  it("usa a API interna da ONE (http, 0 créditos)", () => {
    expect(CARRIERS.one.strategy).toBe("http");
  });

  it("usa o portal público da Kuehne + Nagel (http, 0 créditos)", () => {
    expect(CARRIERS.kuehne.strategy).toBe("http");
    expect(CARRIERS.kuehne.accepts).toContain("container");
  });

  it("aceita consulta por container em todos os armadores mapeados", () => {
    for (const carrier of Object.keys(CARRIERS) as Array<
      keyof typeof CARRIERS
    >) {
      expect(carrierSupportsContainer(carrier)).toBe(true);
    }
    expect(carrierSupportsContainer(undefined)).toBe(true);
  });
});

describe("buildCarrierDeepLink", () => {
  it("monta a URL de cada armador", () => {
    expect(
      buildCarrierDeepLink({
        carrier: "maersk",
        queryType: "bl",
        queryValue: "BL123",
      }),
    ).toBe("https://www.maersk.com/tracking/BL123");

    expect(
      buildCarrierDeepLink({
        carrier: "cma",
        queryType: "container",
        queryValue: "CSQU3054383",
      }),
    ).toContain("SearchBy=CONTAINER");

    expect(
      buildCarrierDeepLink({
        carrier: "cosco",
        queryType: "bl",
        queryValue: "BL123",
      }),
    ).toContain("trackingType=blNumber");

    expect(
      buildCarrierDeepLink({
        carrier: "hapag",
        queryType: "container",
        queryValue: "CSQU3054383",
      }),
    ).toContain("track-by-container-solution.html");

    expect(
      buildCarrierDeepLink({
        carrier: "hapag",
        queryType: "bl",
        queryValue: "HLCUSHA2502BAXD3",
      }),
    ).toContain("track-by-booking-solution.html");

    expect(
      buildCarrierDeepLink({
        carrier: "evergreen",
        queryType: "bl",
        queryValue: "143600393412",
      }),
    ).toBe("https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do");

    expect(
      buildCarrierDeepLink({
        carrier: "oocl",
        queryType: "bl",
        queryValue: "OOLU2339436740",
      }),
    ).toContain("oocl.com/eng/ourservices/eservices/cargotracking");

    expect(
      buildCarrierDeepLink({
        carrier: "hmm",
        queryType: "bl",
        queryValue: "TSNM72593800",
      }),
    ).toContain("hmm21.com/e-service/general/trackNTrace");

    expect(
      buildCarrierDeepLink({
        carrier: "one",
        queryType: "bl",
        queryValue: "ONEYSZPGC3008300",
      }),
    ).toContain("trakNoParam=ONEYSZPGC3008300");
    expect(
      buildCarrierDeepLink({
        carrier: "one",
        queryType: "container",
        queryValue: "TCKU7925277",
      }),
    ).toContain("trakNoTpCdParam=C");

    expect(
      buildCarrierDeepLink({
        carrier: "kuehne",
        queryType: "bl",
        queryValue: "SK#606N000455SZ1",
      }),
    ).toBe(
      "https://mykn.kuehne-nagel.com/public-tracking/shipments?query=SK%23606N000455SZ1",
    );
  });

  it("escapa o valor e devolve null para armador desconhecido", () => {
    expect(
      buildCarrierDeepLink({
        carrier: "msc",
        queryType: "bl",
        queryValue: "BL 123/4",
      }),
    ).toContain("BL%20123%2F4");

    expect(
      buildCarrierDeepLink({
        carrier: "unknown",
        queryType: "bl",
        queryValue: "BL123",
      }),
    ).toBeNull();
  });

  it("monta a URL nova da COSCO com o tipo de busca", () => {
    expect(
      buildCarrierDeepLink({
        carrier: "cosco",
        queryType: "bl",
        queryValue: "COSU6508676460",
      }),
    ).toContain("trackingType=blNumber");
    expect(
      buildCarrierDeepLink({
        carrier: "cosco",
        queryType: "container",
        queryValue: "GAOU7393528",
      }),
    ).toContain("trackingType=containerNumber");
  });
});
