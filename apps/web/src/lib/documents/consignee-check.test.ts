import { describe, expect, it } from "vitest";

import {
  compareConsignee,
  parseConsigneeDivergences,
  snapshotFromExtractedParty,
  type ConsigneeSnapshot,
} from "@/lib/documents/consignee-check";
import {
  EMPTY_PARTY_ADDRESS,
  type PartyAddress,
} from "@/lib/documents/parties-shared";

type SnapshotPatch = {
  name?: string | null;
  cnpj?: string | null;
  address?: Partial<PartyAddress>;
};

function snapshot(patch: SnapshotPatch = {}): ConsigneeSnapshot {
  return {
    name: patch.name ?? null,
    cnpj: patch.cnpj ?? null,
    address: { ...EMPTY_PARTY_ADDRESS, ...patch.address },
  };
}

describe("snapshotFromExtractedParty", () => {
  it("devolve null quando não há nome, CNPJ nem endereço", () => {
    expect(snapshotFromExtractedParty(null)).toBeNull();
    expect(snapshotFromExtractedParty(undefined)).toBeNull();
    expect(snapshotFromExtractedParty({})).toBeNull();
    expect(
      snapshotFromExtractedParty({ name: "   ", cnpj: "  ", address: null }),
    ).toBeNull();
    expect(
      snapshotFromExtractedParty({
        address: { ...EMPTY_PARTY_ADDRESS, street: "   " },
      }),
    ).toBeNull();
  });

  it("apara nome e CNPJ e normaliza o endereço", () => {
    const result = snapshotFromExtractedParty({
      name: "  Alfa Importadora  ",
      cnpj: " 11.222.333/0001-81 ",
      address: {
        street: "Rua A",
        number: "100",
        city: "São Paulo",
        state: "SP",
        country: "Brasil",
      },
    });

    expect(result).toEqual({
      name: "Alfa Importadora",
      cnpj: "11.222.333/0001-81",
      address: {
        ...EMPTY_PARTY_ADDRESS,
        street: "Rua A",
        number: "100",
        city: "São Paulo",
        state: "SP",
        country: "Brasil",
      },
    });
  });

  it("mantém um snapshot apenas com endereço", () => {
    const result = snapshotFromExtractedParty({
      address: { street: "Rua B" },
    });

    expect(result).toMatchObject({
      name: null,
      cnpj: null,
      address: { street: "Rua B" },
    });
  });
});

describe("compareConsignee", () => {
  const divergentFields: Array<
    [
      field: string,
      label: string,
      document: SnapshotPatch,
      defaultConsignee: SnapshotPatch,
      expectedDocument: string,
      expectedDefault: string,
    ]
  > = [
    ["name", "Nome", { name: "Empresa Doc" }, { name: "Empresa Padrão" }, "EMPRESA DOC", "EMPRESA PADRÃO"],
    [
      "cnpj",
      "CNPJ",
      { cnpj: "11.222.333/0001-81" },
      { cnpj: "99.888.777/0001-66" },
      "11222333000181",
      "99888777000166",
    ],
    [
      "street",
      "Logradouro",
      { address: { street: "Rua Doc" } },
      { address: { street: "Rua Padrão" } },
      "RUA DOC",
      "RUA PADRÃO",
    ],
    [
      "number",
      "Número",
      { address: { number: "100" } },
      { address: { number: "200" } },
      "100",
      "200",
    ],
    [
      "complement",
      "Complemento",
      { address: { complement: "Sala 1" } },
      { address: { complement: "Sala 2" } },
      "SALA 1",
      "SALA 2",
    ],
    [
      "postalCode",
      "CEP",
      { address: { postalCode: "01310-100" } },
      { address: { postalCode: "04567 000" } },
      "01310100",
      "04567000",
    ],
    [
      "city",
      "Cidade",
      { address: { city: "Campinas" } },
      { address: { city: "Santos" } },
      "CAMPINAS",
      "SANTOS",
    ],
    [
      "state",
      "UF/Estado",
      { address: { state: "SP" } },
      { address: { state: "RJ" } },
      "SP",
      "RJ",
    ],
    [
      "country",
      "País",
      { address: { country: "Brazil" } },
      { address: { country: "Argentina" } },
      "BRASIL",
      "ARGENTINA",
    ],
    [
      "other",
      "Bairro/Outros",
      { address: { other: "Centro" } },
      { address: { other: "Zona Industrial" } },
      "CENTRO",
      "ZONA INDUSTRIAL",
    ],
  ];

  it.each(divergentFields)(
    "registra divergência em %s (%s)",
    (field, label, documentPatch, defaultPatch, documentValue, defaultConsigneeValue) => {
      expect(
        compareConsignee(snapshot(documentPatch), snapshot(defaultPatch)),
      ).toEqual([
        {
          field,
          label,
          documentValue,
          defaultConsigneeValue,
        },
      ]);
    },
  );

  it("não gera divergência quando os valores são equivalentes após normalizar", () => {
    const document = snapshot({
      name: "  empresa   alfa ",
      cnpj: "11.222.333/0001-81",
      address: {
        postalCode: "01310-100",
        city: "são  paulo",
        state: "Santa Catarina",
        country: "Brazil",
      },
    });
    const defaultConsignee = snapshot({
      name: "EMPRESA ALFA",
      cnpj: "11222333000181",
      address: {
        postalCode: "01310100",
        city: "SÃO PAULO",
        state: "SC",
        country: "Brasil",
      },
    });

    expect(compareConsignee(document, defaultConsignee)).toEqual([]);
  });

  it("ignora campos vazios no documento (não informado ≠ divergente)", () => {
    const document = snapshot({ address: { street: "Rua A" } });
    const defaultConsignee = snapshot({
      name: "Empresa Padrão",
      cnpj: "11222333000181",
      address: {
        street: "Rua A",
        number: "100",
        city: "São Paulo",
        country: "Brasil",
      },
    });

    expect(compareConsignee(document, defaultConsignee)).toEqual([]);
  });

  it("devolve defaultConsigneeValue null quando o padrão não tem o campo", () => {
    const document = snapshot({
      name: "Empresa Doc",
      address: { street: "Rua Doc" },
    });
    const defaultConsignee = snapshot({ cnpj: "11222333000181" });

    expect(compareConsignee(document, defaultConsignee)).toEqual([
      {
        field: "name",
        label: "Nome",
        documentValue: "EMPRESA DOC",
        defaultConsigneeValue: null,
      },
      {
        field: "street",
        label: "Logradouro",
        documentValue: "RUA DOC",
        defaultConsigneeValue: null,
      },
    ]);
  });

  it("devolve lista vazia sem documento ou sem padrão", () => {
    expect(compareConsignee(null, snapshot({ name: "Padrão" }))).toEqual([]);
    expect(compareConsignee(snapshot({ name: "Doc" }), null)).toEqual([]);
    expect(compareConsignee(null, null)).toEqual([]);
  });
});

describe("parseConsigneeDivergences", () => {
  it("devolve null quando o valor não é array", () => {
    expect(parseConsigneeDivergences(null)).toBeNull();
    expect(parseConsigneeDivergences(undefined)).toBeNull();
    expect(parseConsigneeDivergences("x")).toBeNull();
    expect(parseConsigneeDivergences({ field: "name" })).toBeNull();
  });

  it("devolve lista vazia para array vazio", () => {
    expect(parseConsigneeDivergences([])).toEqual([]);
  });

  it("filtra itens inválidos e preserva os válidos", () => {
    const parsed = parseConsigneeDivergences([
      {
        field: "name",
        label: "Nome",
        documentValue: "EMPRESA DOC",
        defaultConsigneeValue: "EMPRESA PADRÃO",
      },
      {
        field: "cnpj",
        label: "CNPJ",
        documentValue: "11222333000181",
        defaultConsigneeValue: null,
      },
      { field: "street" },
      { field: 1, label: "Logradouro", documentValue: null, defaultConsigneeValue: null },
      { field: "city", label: 2, documentValue: null, defaultConsigneeValue: null },
      { field: "state", label: "UF/Estado", documentValue: 3, defaultConsigneeValue: null },
      { field: "country", label: "País", documentValue: null, defaultConsigneeValue: false },
      null,
      "texto",
      ["array"],
    ]);

    expect(parsed).toEqual([
      {
        field: "name",
        label: "Nome",
        documentValue: "EMPRESA DOC",
        defaultConsigneeValue: "EMPRESA PADRÃO",
      },
      {
        field: "cnpj",
        label: "CNPJ",
        documentValue: "11222333000181",
        defaultConsigneeValue: null,
      },
    ]);
  });
});
