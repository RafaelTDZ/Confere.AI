import { describe, expect, it } from "vitest";

import {
  displayImportReference,
  fallbackSavedReference,
  normalizeImportKey,
} from "./imports-shared";

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
