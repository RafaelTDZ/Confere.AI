import "server-only";

import {
  buildCarrierDeepLink,
  type CarrierCode,
} from "@/lib/tracking/carriers";
import type { TrackingQueryType } from "@/lib/tracking/shared";

type FirecrawlAction = Record<string, unknown>;

/**
 * URL que o Firecrawl deve abrir. Portais que só respondem ao formulário
 * (CMA) precisam da página base; os demais aceitam o deep link.
 */
export function buildCarrierScrapeUrl(params: {
  carrier: CarrierCode;
  queryType: TrackingQueryType;
  queryValue: string;
}): string | null {
  if (params.carrier === "cma") {
    return "https://www.cma-cgm.com/ebusiness/tracking";
  }
  if (params.carrier === "hapag") {
    return params.queryType === "container"
      ? "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html"
      : "https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html";
  }
  return buildCarrierDeepLink(params);
}

/**
 * Alguns portais só retornam resultado após preencher e submeter o formulário
 * (a URL com query string é ignorada). As ações rodam antes da captura.
 */
export function buildCarrierActions(params: {
  carrier: CarrierCode;
  queryType: TrackingQueryType;
  queryValue: string;
}): FirecrawlAction[] | undefined {
  if (params.carrier === "cma" && params.queryType === "container") {
    return [
      { type: "wait", milliseconds: 3_000 },
      { type: "click", selector: "#Reference" },
      { type: "write", text: params.queryValue },
      { type: "wait", milliseconds: 600 },
      { type: "press", key: "Enter" },
      { type: "wait", milliseconds: 9_000 },
    ];
  }

  if (params.carrier === "evergreen") {
    return [
      { type: "wait", milliseconds: 3_000 },
      {
        type: "click",
        selector: params.queryType === "bl" ? "#s_bl" : "#s_cntr",
      },
      { type: "click", selector: "#NO" },
      { type: "write", text: params.queryValue },
      { type: "wait", milliseconds: 500 },
      {
        type: "click",
        selector: 'form[name="frmCargo"] input[type="button"]',
      },
      { type: "wait", milliseconds: 9_000 },
    ];
  }

  if (params.carrier === "hapag") {
    const isContainer = params.queryType === "container";
    const prefix = isContainer ? "tracing_by_container_f" : "tracing_by_booking_f";
    const input = isContainer
      ? "hl12"
      : params.queryType === "booking"
        ? "hl12"
        : "hl16";
    const clear = isContainer ? "hl26" : "hl19";
    const find = isContainer ? "hl25" : "hl18";

    return [
      { type: "wait", milliseconds: 4_000 },
      { type: "click", selector: `[id="${prefix}:${input}"]` },
      { type: "click", selector: `[id="${prefix}:${clear}"]` },
      { type: "click", selector: `[id="${prefix}:${input}"]` },
      { type: "write", text: params.queryValue },
      { type: "click", selector: `[id="${prefix}:${find}"]` },
      { type: "wait", milliseconds: 12_000 },
    ];
  }

  return undefined;
}
