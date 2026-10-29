import { afterEach, describe, expect, it, vi } from "vitest";

import {
  trackingFarEtaIntervalMs,
  trackingInTransitIntervalMs,
  trackingRefreshCooldownMinutes,
} from "@/lib/tracking/config";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cadência de rastreio", () => {
  it("consulta diariamente com ETA próximo e semanalmente com ETA longe", () => {
    vi.stubEnv("TRACKING_IN_TRANSIT_INTERVAL_MINUTES", "");
    vi.stubEnv("TRACKING_FAR_ETA_INTERVAL_MINUTES", "");

    expect(trackingInTransitIntervalMs()).toBe(DAY_MS);
    expect(trackingFarEtaIntervalMs()).toBe(7 * DAY_MS);
  });

  it("respeita o override por env em minutos", () => {
    vi.stubEnv("TRACKING_IN_TRANSIT_INTERVAL_MINUTES", "720");
    vi.stubEnv("TRACKING_FAR_ETA_INTERVAL_MINUTES", "2880");

    expect(trackingInTransitIntervalMs()).toBe(12 * 60 * 60 * 1000);
    expect(trackingFarEtaIntervalMs()).toBe(2 * DAY_MS);
  });

  it("ignora valor inválido e mantém o default", () => {
    vi.stubEnv("TRACKING_IN_TRANSIT_INTERVAL_MINUTES", "0");
    vi.stubEnv("TRACKING_FAR_ETA_INTERVAL_MINUTES", "semanal");

    expect(trackingInTransitIntervalMs()).toBe(DAY_MS);
    expect(trackingFarEtaIntervalMs()).toBe(7 * DAY_MS);
  });
});

describe("cooldown do botão Atualizar", () => {
  it("usa 30 minutos por padrão", () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "");

    expect(trackingRefreshCooldownMinutes()).toBe(30);
  });

  it("permite override e desativa com 0", () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "15");
    expect(trackingRefreshCooldownMinutes()).toBe(15);

    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "0");
    expect(trackingRefreshCooldownMinutes()).toBe(0);
  });

  it("cai no default com valor inválido", () => {
    for (const value of ["-5", "abc", "2.5", " "]) {
      vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", value);
      expect(trackingRefreshCooldownMinutes()).toBe(30);
    }
  });
});
