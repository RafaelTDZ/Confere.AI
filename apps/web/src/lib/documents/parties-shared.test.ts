import { describe, expect, it } from "vitest";

import {
  EMPTY_PARTY_ADDRESS,
  formatAddressLine,
  formatCepInput,
  formatCnpj,
  formatCnpjInput,
  isValidCnpjDigits,
  mergePartyAddress,
  normalizeCnpjDigits,
  parsePartyAddress,
  type PartyAddress,
} from "./parties-shared";

describe("normalizeCnpjDigits", () => {
  it("remove caracteres não numéricos", () => {
    expect(normalizeCnpjDigits("12.345.678/9012-34")).toBe("12345678901234");
  });

  it("limita a 14 dígitos", () => {
    expect(normalizeCnpjDigits("123456789012349999")).toBe("12345678901234");
  });

  it("retorna vazio para null", () => {
    expect(normalizeCnpjDigits(null)).toBe("");
  });
});

describe("formatCnpj", () => {
  it("formata 14 dígitos", () => {
    expect(formatCnpj("12345678901234")).toBe("12.345.678/9012-34");
  });

  it("retorna apenas os dígitos quando o comprimento é diferente de 14", () => {
    expect(formatCnpj("1234567890123")).toBe("1234567890123");
    expect(formatCnpj("1234")).toBe("1234");
    expect(formatCnpj("")).toBe("");
  });
});

describe("formatCnpjInput", () => {
  it("formata progressivamente conforme a digitação", () => {
    expect(formatCnpjInput("12")).toBe("12");
    expect(formatCnpjInput("12345")).toBe("12.345");
    expect(formatCnpjInput("12345678")).toBe("12.345.678");
    expect(formatCnpjInput("123456789012")).toBe("12.345.678/9012");
    expect(formatCnpjInput("12345678901234")).toBe("12.345.678/9012-34");
  });
});

describe("isValidCnpjDigits", () => {
  it("retorna true somente com 14 dígitos", () => {
    expect(isValidCnpjDigits("12345678901234")).toBe(true);
    expect(isValidCnpjDigits("1234567890123")).toBe(false);
    expect(isValidCnpjDigits("123456789012345")).toBe(false);
    expect(isValidCnpjDigits("")).toBe(false);
  });
});

describe("parsePartyAddress", () => {
  it("usa a string recebida como other", () => {
    expect(parsePartyAddress("Rua das Flores, 100")).toEqual({
      ...EMPTY_PARTY_ADDRESS,
      other: "Rua das Flores, 100",
    });
  });

  it("lê campos em snake_case do objeto", () => {
    expect(
      parsePartyAddress({
        street: "Rua das Flores",
        street_number: "100",
        postal_code: "12345-678",
        other_info: "Próximo ao porto",
      }),
    ).toEqual({
      ...EMPTY_PARTY_ADDRESS,
      street: "Rua das Flores",
      number: "100",
      postalCode: "12345-678",
      other: "Próximo ao porto",
    });
  });

  it("retorna endereço vazio para objeto inválido, array ou null", () => {
    const empty = { ...EMPTY_PARTY_ADDRESS };
    expect(parsePartyAddress({})).toEqual(empty);
    expect(parsePartyAddress([])).toEqual(empty);
    expect(parsePartyAddress(null)).toEqual(empty);
    expect(parsePartyAddress(undefined)).toEqual(empty);
    expect(parsePartyAddress(42)).toEqual(empty);
  });

  it("converte strings vazias em null", () => {
    expect(
      parsePartyAddress({
        street: "   ",
        number: "",
        postal_code: " ",
        city: "",
      }),
    ).toEqual({ ...EMPTY_PARTY_ADDRESS });
  });
});

describe("mergePartyAddress", () => {
  it("mantém o valor atual quando preenchido", () => {
    const current: PartyAddress = {
      ...EMPTY_PARTY_ADDRESS,
      street: "Rua Atual",
      city: "São Paulo",
    };
    const incoming: PartyAddress = {
      ...EMPTY_PARTY_ADDRESS,
      street: "Rua Nova",
      city: "Campinas",
      state: "SP",
    };

    expect(mergePartyAddress(current, incoming)).toEqual({
      ...EMPTY_PARTY_ADDRESS,
      street: "Rua Atual",
      city: "São Paulo",
      state: "SP",
    });
  });

  it("preenche campos vazios do atual com o incoming", () => {
    const current: PartyAddress = {
      ...EMPTY_PARTY_ADDRESS,
      city: "São Paulo",
    };
    const incoming: PartyAddress = {
      ...EMPTY_PARTY_ADDRESS,
      street: "Rua Nova",
      number: "200",
      city: "Campinas",
    };

    expect(mergePartyAddress(current, incoming)).toEqual({
      ...EMPTY_PARTY_ADDRESS,
      street: "Rua Nova",
      number: "200",
      city: "São Paulo",
    });
  });
});

describe("formatAddressLine", () => {
  it("junta rua e número com vírgula e os demais com separador", () => {
    expect(
      formatAddressLine({
        ...EMPTY_PARTY_ADDRESS,
        street: "Rua das Flores",
        number: "100",
        complement: "Sala 2",
        postalCode: "12345-678",
        city: "São Paulo",
        state: "SP",
        country: "Brasil",
        other: "Próximo ao porto",
      }),
    ).toBe(
      "Rua das Flores, 100 · Sala 2 · 12345-678 · São Paulo · SP · Brasil · Próximo ao porto",
    );
  });

  it("retorna vazio para endereço null ou undefined", () => {
    expect(formatAddressLine(null)).toBe("");
    expect(formatAddressLine(undefined)).toBe("");
  });

  it("ignora campos vazios", () => {
    expect(
      formatAddressLine({
        ...EMPTY_PARTY_ADDRESS,
        city: "São Paulo",
        state: "SP",
      }),
    ).toBe("São Paulo · SP");
  });
});

describe("formatCepInput", () => {
  it("aceita letras e limita a 16 caracteres", () => {
    expect(formatCepInput("ABC123")).toBe("ABC123");
    expect(formatCepInput("ABCDEFGHIJKLMNOPQRST")).toBe("ABCDEFGHIJKLMNOP");
  });

  it("formata 8 dígitos com hífen", () => {
    expect(formatCepInput("12345678")).toBe("12345-678");
  });

  it("não adiciona hífen até 5 dígitos", () => {
    expect(formatCepInput("12345")).toBe("12345");
  });
});
