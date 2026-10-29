import { describe, expect, it } from "vitest";

import { formatUfInput, normalizeUf } from "@/lib/documents/uf-shared";

const UFS: ReadonlyArray<[string, string]> = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
];

describe("normalizeUf", () => {
  it("reconhece as 27 siglas em qualquer caixa e com espaços", () => {
    expect(UFS).toHaveLength(27);

    for (const [code] of UFS) {
      expect(normalizeUf(code)).toBe(code);
      expect(normalizeUf(code.toLowerCase())).toBe(code);
      expect(normalizeUf(`  ${code.toLowerCase()}  `)).toBe(code);
    }
  });

  it("reconhece o nome por extenso com ou sem acento", () => {
    for (const [code, name] of UFS) {
      expect(normalizeUf(name)).toBe(code);
      expect(normalizeUf(name.toUpperCase())).toBe(code);
      expect(normalizeUf(name.toLowerCase())).toBe(code);
    }
  });

  it("converte os exemplos do produto para a sigla", () => {
    expect(normalizeUf("sc")).toBe("SC");
    expect(normalizeUf(" Sc ")).toBe("SC");
    expect(normalizeUf("Santa Catarina")).toBe("SC");
    expect(normalizeUf("SÃO PAULO")).toBe("SP");
    expect(normalizeUf("são paulo")).toBe("SP");
    expect(normalizeUf("SANTA   CATARINA")).toBe("SC");
    expect(normalizeUf("S.C.")).toBe("SC");
    expect(normalizeUf("S C")).toBe("SC");
  });

  it("devolve null para valores inválidos", () => {
    expect(normalizeUf("XX")).toBeNull();
    expect(normalizeUf("Catarina")).toBeNull();
    expect(normalizeUf("Santa")).toBeNull();
    expect(normalizeUf("Brasil")).toBeNull();
    expect(normalizeUf("")).toBeNull();
    expect(normalizeUf("   ")).toBeNull();
    expect(normalizeUf(null)).toBeNull();
    expect(normalizeUf(undefined)).toBeNull();
  });
});

describe("formatUfInput", () => {
  it("mantém a sigla e normaliza o valor digitado", () => {
    expect(formatUfInput("sc")).toBe("SC");
    expect(formatUfInput("s")).toBe("S");
    expect(formatUfInput("Sc ")).toBe("SC");
  });

  it("converte nome por extenso colado para a sigla", () => {
    expect(formatUfInput("Santa Catarina")).toBe("SC");
    expect(formatUfInput("são paulo")).toBe("SP");
  });

  it("descarta caracteres inválidos e limita a duas letras", () => {
    expect(formatUfInput("S.C.")).toBe("SC");
    expect(formatUfInput("xyz")).toBe("XY");
    expect(formatUfInput("12")).toBe("");
    expect(formatUfInput("   ")).toBe("");
  });
});
