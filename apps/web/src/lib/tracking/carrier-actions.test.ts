import { describe, expect, it } from "vitest";
import {
  buildCarrierActions,
  buildCarrierScrapeUrl,
} from "@/lib/tracking/carrier-actions";

describe("buildCarrierScrapeUrl", () => {
  it("usa a página base nos portais que só respondem ao formulário", () => {
    expect(
      buildCarrierScrapeUrl({
        carrier: "cma",
        queryType: "container",
        queryValue: "CAIU9274323",
      }),
    ).toBe("https://www.cma-cgm.com/ebusiness/tracking");

    expect(
      buildCarrierScrapeUrl({
        carrier: "evergreen",
        queryType: "bl",
        queryValue: "143600393412",
      }),
    ).toBe("https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do");
  });

  it("mantém o deep link nos armadores que aceitam URL", () => {
    expect(
      buildCarrierScrapeUrl({
        carrier: "maersk",
        queryType: "bl",
        queryValue: "BL123",
      }),
    ).toBe("https://www.maersk.com/tracking/BL123");
  });
});

describe("buildCarrierActions", () => {
  it("preenche o formulário da Evergreen conforme o tipo de busca", () => {
    const bl = buildCarrierActions({
      carrier: "evergreen",
      queryType: "bl",
      queryValue: "143600393412",
    });
    expect(bl?.some((action) => action.selector === "#s_bl")).toBe(true);
    expect(bl?.some((action) => action.text === "143600393412")).toBe(true);

    const container = buildCarrierActions({
      carrier: "evergreen",
      queryType: "container",
      queryValue: "TLLU7681880",
    });
    expect(container?.some((action) => action.selector === "#s_cntr")).toBe(
      true,
    );
  });

  it("não cria ações para armadores que aceitam URL", () => {
    expect(
      buildCarrierActions({
        carrier: "maersk",
        queryType: "bl",
        queryValue: "BL123",
      }),
    ).toBeUndefined();
  });

  it("preenche o formulário AEM da Hapag", () => {
    expect(
      buildCarrierScrapeUrl({
        carrier: "hapag",
        queryType: "container",
        queryValue: "HLBU9334723",
      }),
    ).toContain("track-by-container-solution");

    const actions = buildCarrierActions({
      carrier: "hapag",
      queryType: "container",
      queryValue: "HLBU9334723",
    });
    expect(
      actions?.some(
        (action) => action.selector === '[id="tracing_by_container_f:hl12"]',
      ),
    ).toBe(true);
    expect(
      actions?.some(
        (action) => action.selector === '[id="tracing_by_container_f:hl25"]',
      ),
    ).toBe(true);
  });
});
