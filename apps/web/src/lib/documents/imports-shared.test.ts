import { describe, expect, it } from "vitest";

import {
  displayImportReference,
  fallbackSavedReference,
  importShipmentStage,
  IMPORT_SHIPMENT_STAGE_LABELS,
  normalizeImportKey,
  trackingStatusPriority,
  type ImportShipmentStage,
} from "./imports-shared";

describe("importShipmentStage", () => {
  it("retorna aguardando embarque sem data de embarque nem status de rastreio", () => {
    expect(importShipmentStage({})).toBe("awaiting_shipment");
    expect(
      importShipmentStage({ onboardDate: null, status: null }),
    ).toBe("awaiting_shipment");
    expect(
      importShipmentStage({ onboardDate: "  ", status: "" }),
    ).toBe("awaiting_shipment");
  });

  it("retorna em trânsito com data de embarque", () => {
    expect(importShipmentStage({ onboardDate: "10/10/2026" })).toBe(
      "in_transit",
    );
    expect(
      importShipmentStage({ onboardDate: "10/10/2026", status: null }),
    ).toBe("in_transit");
  });

  it("retorna em trânsito com qualquer status informativo ainda não chegado", () => {
    for (const status of [
      "pending",
      "in_transit",
      "transshipment",
      "not_found",
      "blocked",
      "error",
    ]) {
      expect(importShipmentStage({ status })).toBe("in_transit");
    }
  });

  it("retorna chegada confirmada só com status de chegada/final", () => {
    for (const status of [
      "arrived",
      "discharged",
      "delivered",
      "empty_returned",
    ]) {
      expect(importShipmentStage({ status })).toBe("arrived");
      expect(
        importShipmentStage({ onboardDate: "10/10/2026", status }),
      ).toBe("arrived");
    }
  });

  it("ignora a ATA: embarque em trânsito continua em trânsito", () => {
    expect(
      importShipmentStage({
        onboardDate: "10/10/2026",
        status: "in_transit",
      }),
    ).toBe("in_transit");
  });

  it("prioriza chegada > em trânsito > demais status", () => {
    expect(trackingStatusPriority("arrived")).toBeGreaterThan(
      trackingStatusPriority("in_transit"),
    );
    expect(trackingStatusPriority("transshipment")).toBeGreaterThan(
      trackingStatusPriority("not_found"),
    );
    expect(trackingStatusPriority("delivered")).toBeGreaterThan(
      trackingStatusPriority("in_transit"),
    );
  });

  it("expõe rótulos para cada etapa", () => {
    const stages: ImportShipmentStage[] = [
      "awaiting_shipment",
      "in_transit",
      "arrived",
    ];
    expect(stages.map((stage) => IMPORT_SHIPMENT_STAGE_LABELS[stage])).toEqual([
      "Aguardando embarque",
      "Em trânsito",
      "Chegada confirmada",
    ]);
  });
});

describe("normalizeImportKey", () => {
  it("retorna null para valores vazios", () => {
    expect(normalizeImportKey(null)).toBeNull();
    expect(normalizeImportKey(undefined)).toBeNull();
    expect(normalizeImportKey("")).toBeNull();
    expect(normalizeImportKey("   ")).toBeNull();
  });

  it("remove espaços extras e converte para maiúsculas", () => {
    expect(normalizeImportKey("  inv   123 ")).toBe("INV 123");
  });

  it("converte minúsculas em maiúsculas", () => {
    expect(normalizeImportKey("inv-123")).toBe("INV-123");
  });
});

describe("fallbackSavedReference", () => {
  it("prefere o número do BL", () => {
    expect(
      fallbackSavedReference({
        blNumber: "BL-001",
        invoiceNumber: "INV-001",
      }),
    ).toBe("BL-001");
  });

  it("usa o número da Invoice quando o BL é null", () => {
    expect(
      fallbackSavedReference({
        blNumber: null,
        invoiceNumber: "INV-001",
      }),
    ).toBe("INV-001");
  });

  it("retorna null quando ambos são null", () => {
    expect(
      fallbackSavedReference({
        blNumber: null,
        invoiceNumber: null,
      }),
    ).toBeNull();
  });
});

describe("displayImportReference", () => {
  it("retorna vazio sem reference_number", () => {
    expect(
      displayImportReference({
        reference_number: null,
        invoice_number: "INV-001",
        bl_number: "BL-001",
      }),
    ).toBe("");
  });

  it("retorna vazio quando a referência é igual ao BL", () => {
    expect(
      displayImportReference({
        reference_number: "  bl-001 ",
        invoice_number: "INV-001",
        bl_number: "BL-001",
      }),
    ).toBe("");
  });

  it("retorna vazio quando a referência é igual à Invoice", () => {
    expect(
      displayImportReference({
        reference_number: "inv   001",
        invoice_number: "INV 001",
        bl_number: null,
      }),
    ).toBe("");
  });

  it("retorna vazio para referência gerada automaticamente", () => {
    expect(
      displayImportReference({
        reference_number: "IMP-20261023-AB12CD",
        invoice_number: null,
        bl_number: null,
      }),
    ).toBe("");
  });

  it("retorna a referência manual", () => {
    expect(
      displayImportReference({
        reference_number: "PO-123",
        invoice_number: "INV-001",
        bl_number: "BL-001",
      }),
    ).toBe("PO-123");
  });

  it("remove espaços nas pontas da referência", () => {
    expect(
      displayImportReference({
        reference_number: "  PO-123  ",
        invoice_number: null,
        bl_number: null,
      }),
    ).toBe("PO-123");
  });
});
