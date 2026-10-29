import { describe, expect, it } from "vitest";
import { validateManualTrackingEvent } from "@/lib/tracking/manual-event";

describe("validateManualTrackingEvent", () => {
  it("normaliza a descrição e os opcionais vazios", () => {
    expect(
      validateManualTrackingEvent({
        eventAt: " 2026-10-28 ",
        description: "  Container descarregado  ",
        location: "  Porto de Santos - SP ",
        containerNumber: "   ",
      }),
    ).toEqual({
      ok: true,
      payload: {
        eventAt: "2026-10-28",
        description: "Container descarregado",
        location: "Porto de Santos - SP",
        containerNumber: null,
      },
    });
  });

  it("exige a data do evento", () => {
    expect(
      validateManualTrackingEvent({
        eventAt: "",
        description: "Chegou ao porto",
      }),
    ).toEqual({ ok: false, error: "Informe a data do evento." });
  });

  it("recusa data fora do formato ISO do input", () => {
    expect(
      validateManualTrackingEvent({
        eventAt: "28/10/2026",
        description: "Chegou ao porto",
      }),
    ).toEqual({ ok: false, error: "Data do evento inválida." });
  });

  it("exige a descrição", () => {
    expect(
      validateManualTrackingEvent({
        eventAt: "2026-10-28",
        description: "   ",
      }),
    ).toEqual({ ok: false, error: "Descreva o evento." });
  });
});
