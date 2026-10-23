import { describe, expect, it } from "vitest";

import {
  blExtractionSchema,
  documentClassificationSchema,
  invoiceExtractionSchema,
  packingListExtractionSchema,
} from "@/lib/ai/schemas";

const ENDERECO = {
  street: "Rua das Importações",
  number: "100",
  complement: null,
  postalCode: "01000-000",
  city: "São Paulo",
  state: "SP",
  country: "Brasil",
  other: null,
};

const PARTE = {
  name: "Empresa Exemplo Ltda",
  cnpj: "12.345.678/0001-90",
  address: ENDERECO,
};

function invoiceValida() {
  return {
    number: "INV-001",
    blNumber: null,
    exporter: { name: "Shipper Exemplo" },
    importer: PARTE,
    notify: PARTE,
    products: [
      {
        code: "SKU-1",
        ncm: "12345678",
        description: "Produto de exemplo",
      },
    ],
  };
}

function blValido() {
  return {
    number: "BL-001",
    carrier: "Armador Exemplo",
    shipper: "Shipper Exemplo",
    consignee: "Consignatária Exemplo",
    consigneeDetails: PARTE,
    notifyParty: "Notify Exemplo",
    notifyPartyDetails: PARTE,
    polCity: "Shanghai",
    polCountry: "China",
    podCity: "Santos",
    podCountry: "Brasil",
    vessel: "Navio Exemplo",
    voyage: "001",
    descriptionOfGoods: "Carga de exemplo",
    grossWeight: "1000.5",
    volumes: "10",
    packages: "CAIXAS",
    measurement: "20.5",
    freightValue: "500.00",
    freightCurrency: "USD",
    freightTerms: "PREPAID",
    freeTime: null,
    ncm: ["12345678"],
    containerNumbers: ["ABCD1234567"],
    containerQuantity: "1",
    containerType: "40HC",
    sealNumbers: ["SEAL-1"],
    onboardDate: "2026-01-10",
    eta: "2026-02-20",
  };
}

function semCampo(
  payload: Record<string, unknown>,
  campo: string,
): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...payload };
  delete copia[campo];
  return copia;
}

describe("documentClassificationSchema", () => {
  it("aceita todos os tipos de documento com notes nulo", () => {
    const resultado = documentClassificationSchema.safeParse({
      types: ["invoice", "packing_list", "bill_of_lading"],
      notes: null,
    });

    expect(resultado.success).toBe(true);
  });

  it("aceita um único tipo e notes em texto", () => {
    const resultado = documentClassificationSchema.safeParse({
      types: ["invoice"],
      notes: "Documento único de importação",
    });

    expect(resultado.success).toBe(true);
  });

  it("rejeita tipo de documento desconhecido", () => {
    const resultado = documentClassificationSchema.safeParse({
      types: ["invoice", "receipt"],
      notes: null,
    });

    expect(resultado.success).toBe(false);
  });

  it("rejeita lista de tipos vazia", () => {
    const resultado = documentClassificationSchema.safeParse({
      types: [],
      notes: null,
    });

    expect(resultado.success).toBe(false);
  });

  it("rejeita notes ausente", () => {
    const resultado = documentClassificationSchema.safeParse({
      types: ["invoice"],
    });

    expect(resultado.success).toBe(false);
  });

  it("rejeita notes com tipo errado", () => {
    const resultado = documentClassificationSchema.safeParse({
      types: ["invoice"],
      notes: 123,
    });

    expect(resultado.success).toBe(false);
  });
});

describe("invoiceExtractionSchema", () => {
  it("aceita o payload mínimo válido", () => {
    const resultado = invoiceExtractionSchema.safeParse(invoiceValida());

    expect(resultado.success).toBe(true);
  });

  it("aceita produtos vazios e campos anuláveis nulos", () => {
    const resultado = invoiceExtractionSchema.safeParse({
      ...invoiceValida(),
      number: null,
      blNumber: null,
      exporter: { name: null },
      products: [],
    });

    expect(resultado.success).toBe(true);
  });

  it("rejeita payload sem campos obrigatórios", () => {
    const payload = invoiceValida();

    expect(
      invoiceExtractionSchema.safeParse(semCampo(payload, "number")).success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse(semCampo(payload, "products")).success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse(semCampo(payload, "importer")).success,
    ).toBe(false);
  });

  it("rejeita campos com tipo errado", () => {
    expect(
      invoiceExtractionSchema.safeParse({
        ...invoiceValida(),
        number: 123,
      }).success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse({
        ...invoiceValida(),
        products: "SKU-1",
      }).success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse({
        ...invoiceValida(),
        exporter: { name: 123 },
      }).success,
    ).toBe(false);
  });

  it("rejeita endereço incompleto da parte", () => {
    const payload = {
      ...invoiceValida(),
      importer: {
        ...PARTE,
        address: { city: "São Paulo" },
      },
    };

    expect(invoiceExtractionSchema.safeParse(payload).success).toBe(false);
  });
});

describe("packingListExtractionSchema", () => {
  it("aceita invoiceNumber como string", () => {
    expect(
      packingListExtractionSchema.safeParse({ invoiceNumber: "INV-001" })
        .success,
    ).toBe(true);
  });

  it("aceita invoiceNumber nulo", () => {
    expect(
      packingListExtractionSchema.safeParse({ invoiceNumber: null }).success,
    ).toBe(true);
  });

  it("rejeita invoiceNumber ausente", () => {
    expect(packingListExtractionSchema.safeParse({}).success).toBe(false);
  });

  it("rejeita invoiceNumber com tipo errado", () => {
    expect(
      packingListExtractionSchema.safeParse({ invoiceNumber: 123 }).success,
    ).toBe(false);
  });
});

describe("blExtractionSchema", () => {
  it("aceita o payload mínimo válido com os arrays obrigatórios", () => {
    const resultado = blExtractionSchema.safeParse(blValido());

    expect(resultado.success).toBe(true);
  });

  it("aceita arrays obrigatórios vazios", () => {
    const resultado = blExtractionSchema.safeParse({
      ...blValido(),
      ncm: [],
      containerNumbers: [],
      sealNumbers: [],
    });

    expect(resultado.success).toBe(true);
  });

  it("rejeita payload sem campos obrigatórios", () => {
    const payload = blValido();

    expect(blExtractionSchema.safeParse(semCampo(payload, "number")).success).toBe(
      false,
    );
    expect(
      blExtractionSchema.safeParse(semCampo(payload, "consigneeDetails"))
        .success,
    ).toBe(false);
    expect(blExtractionSchema.safeParse(semCampo(payload, "ncm")).success).toBe(
      false,
    );
    expect(
      blExtractionSchema.safeParse(semCampo(payload, "sealNumbers")).success,
    ).toBe(false);
  });

  it("rejeita arrays com tipo errado", () => {
    expect(
      blExtractionSchema.safeParse({
        ...blValido(),
        ncm: "12345678",
      }).success,
    ).toBe(false);
    expect(
      blExtractionSchema.safeParse({
        ...blValido(),
        containerNumbers: [123],
      }).success,
    ).toBe(false);
    expect(
      blExtractionSchema.safeParse({
        ...blValido(),
        sealNumbers: null,
      }).success,
    ).toBe(false);
  });

  it("rejeita endereço incompleto nos detalhes da parte", () => {
    const resultado = blExtractionSchema.safeParse({
      ...blValido(),
      notifyPartyDetails: {
        ...PARTE,
        address: semCampo(ENDERECO, "country"),
      },
    });

    expect(resultado.success).toBe(false);
  });
});
