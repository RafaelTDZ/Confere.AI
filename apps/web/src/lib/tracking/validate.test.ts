import { describe, expect, it } from "vitest";
import {
  containerCheckDigit,
  isValidContainerNumber,
  normalizeBlNumber,
  normalizeTrackingNumber,
  validContainerNumbers,
} from "@/lib/tracking/validate";

describe("normalizeTrackingNumber", () => {
  it("remove pontuação e devolve maiúsculas", () => {
    expect(normalizeTrackingNumber(" mscu-305 4383 ")).toBe("MSCU3054383");
  });

  it("devolve null para vazio", () => {
    expect(normalizeTrackingNumber("  ")).toBeNull();
    expect(normalizeTrackingNumber(null)).toBeNull();
  });
});

describe("containerCheckDigit", () => {
  it("calcula o dígito do exemplo ISO 6346", () => {
    expect(containerCheckDigit("CSQU3054383")).toBe(3);
  });

  it("devolve null quando o formato é inválido", () => {
    expect(containerCheckDigit("CSQU305438")).toBeNull();
    expect(containerCheckDigit("12QU3054383")).toBeNull();
  });
});

describe("isValidContainerNumber", () => {
  it("aceita container com dígito correto", () => {
    expect(isValidContainerNumber("CSQU3054383")).toBe(true);
  });

  it("rejeita dígito incorreto", () => {
    expect(isValidContainerNumber("CSQU3054384")).toBe(false);
  });
});

describe("normalizeBlNumber", () => {
  it("normaliza BL com espaços e hífens", () => {
    expect(normalizeBlNumber(" bl-2026 001 ")).toBe("BL2026001");
  });

  it("descarta valores curtos ou longos demais", () => {
    expect(normalizeBlNumber("AB1")).toBeNull();
    expect(normalizeBlNumber("A".repeat(31))).toBeNull();
  });
});

describe("validContainerNumbers", () => {
  it("deduplica, valida e respeita o limite", () => {
    expect(
      validContainerNumbers(
        ["CSQU3054383", "csqu3054383", "CSQU3054384", "MSCU1234567"],
        1,
      ),
    ).toEqual(["CSQU3054383"]);
  });
});
