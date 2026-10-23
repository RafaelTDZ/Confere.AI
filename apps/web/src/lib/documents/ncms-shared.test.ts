import { describe, expect, it } from "vitest";

import { formatNcmCode, formatNcmInput, normalizeNcmCode } from "./ncms-shared";

describe("normalizeNcmCode", () => {
  it("remove caracteres não numéricos", () => {
    expect(normalizeNcmCode("1234.56.78")).toBe("12345678");
    expect(normalizeNcmCode("NCM 1234-56/78")).toBe("12345678");
  });

  it("retorna vazio para null e undefined", () => {
    expect(normalizeNcmCode(null)).toBe("");
    expect(normalizeNcmCode(undefined)).toBe("");
  });
});

describe("formatNcmCode", () => {
  it("formata 8 dígitos", () => {
    expect(formatNcmCode("12345678")).toBe("1234.56.78");
    expect(formatNcmCode("1234.56.78")).toBe("1234.56.78");
  });

  it("retorna apenas os dígitos quando o comprimento é diferente de 8", () => {
    expect(formatNcmCode("1234567")).toBe("1234567");
    expect(formatNcmCode("123456789")).toBe("123456789");
    expect(formatNcmCode("")).toBe("");
  });
});

describe("formatNcmInput", () => {
  it("não formata de 1 a 4 dígitos", () => {
    expect(formatNcmInput("1")).toBe("1");
    expect(formatNcmInput("123")).toBe("123");
    expect(formatNcmInput("1234")).toBe("1234");
  });

  it("adiciona um ponto de 5 a 6 dígitos", () => {
    expect(formatNcmInput("12345")).toBe("1234.5");
    expect(formatNcmInput("123456")).toBe("1234.56");
  });

  it("adiciona dois pontos de 7 a 8 dígitos", () => {
    expect(formatNcmInput("1234567")).toBe("1234.56.7");
    expect(formatNcmInput("12345678")).toBe("1234.56.78");
  });

  it("retorna até 10 dígitos sem formatação acima de 8", () => {
    expect(formatNcmInput("123456789")).toBe("123456789");
    expect(formatNcmInput("1234567890")).toBe("1234567890");
    expect(formatNcmInput("123456789012")).toBe("1234567890");
  });
});
