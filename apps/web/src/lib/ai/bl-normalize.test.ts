import { describe, expect, it } from "vitest";
import type { BlExtraction } from "@/lib/ai/schemas";
import {
  applyMarkdownFallbacks,
  formatDecimalBr,
  masterBlFromText,
  normalizeBlExtraction,
  normalizeCarrier,
  normalizeContainerType,
  normalizeDateBr,
  normalizeDescription,
  normalizeIntegerBr,
  parseDecimalBr,
} from "@/lib/ai/bl-normalize";

const ENDERECO = {
  street: "RUA DOS BOROROS",
  number: "665",
  complement: "BAIRRO: ZONA INDUSTRIAL",
  postalCode: "89.239-290",
  city: "JOINVILLE",
  state: "SC",
  country: "BRASIL",
  other: null,
};

const ENDERECO_NOTIFY = {
  street: "R EVARISTO DA VEIGA",
  number: "156",
  complement: "ANDAR 4, CJ 63, GLORIA",
  postalCode: "89.216-215",
  city: "JOINVILLE",
  state: "SC",
  country: "BRASIL",
  other: null,
};

function blOych120(): BlExtraction {
  return {
    number: "PLISZ4H14434",
    masterBlNumber: null,
    carrier: "LX PANTOS LOGISTICS (SHENZHEN) CO., LTD.",
    shipper: "OYH INTERNATIONAL TRADE (SHANGHAI) CO., LTD.",
    consignee: "TDZ COMERCIAL IMPORTADORA E EXPORTADORA LTDA",
    consigneeDetails: {
      name: "TDZ COMERCIAL IMPORTADORA E EXPORTADORA LTDA",
      cnpj: "12.000.106/0001-74",
      address: ENDERECO,
    },
    notifyParty: "OYH BRASIL LTDA",
    notifyPartyDetails: {
      name: "OYH BRASIL LTDA",
      cnpj: "60.238.461/0001-29",
      address: ENDERECO_NOTIFY,
    },
    polCity: "SHEKOU",
    polCountry: "CHINA",
    podCity: "ITAPOA",
    podCountry: "BRAZIL",
    vessel: "CMA CGM KRYPTON",
    voyage: "0BDPFW1MA",
    descriptionOfGoods:
      "TOILET (SHIPPER'S LOAD AND COUNT / SAID TO CONTAIN)",
    grossWeight: "40,093.200",
    volumes: "2,664",
    packages: "CAIXAS",
    measurement: "136.000",
    freightValue: "8,400",
    freightCurrency: "USD",
    freightTerms: "FREIGHT PREPAID",
    freeTime: "21 DAYS",
    ncm: ["6910"],
    containerNumbers: ["TCNU2640912", "TCNU6779444"],
    containerQuantity: "2",
    containerType: "2X40 HC",
    sealNumbers: ["J2697782", "J2697787"],
    onboardDate: "OCT/01/2026",
    eta: null,
  };
}

describe("parseDecimalBr", () => {
  it("entende os formatos do BL e do rider", () => {
    expect(parseDecimalBr("40,093.200")).toEqual({
      value: 40093.2,
      decimals: 3,
    });
    expect(parseDecimalBr("136.000")).toEqual({ value: 136, decimals: 3 });
    expect(parseDecimalBr("1.234,56")).toEqual({ value: 1234.56, decimals: 2 });
    expect(parseDecimalBr("8400")).toEqual({ value: 8400, decimals: 0 });
  });

  it("devolve null para vazio ou inválido", () => {
    expect(parseDecimalBr(null)).toBeNull();
    expect(parseDecimalBr("abc")).toBeNull();
  });
});

describe("formatDecimalBr", () => {
  it("padroniza o número no formato brasileiro", () => {
    expect(formatDecimalBr("40,093.200")).toBe("40.093,200");
    expect(formatDecimalBr("136.000")).toBe("136,000");
    expect(formatDecimalBr("1.234,56")).toBe("1.234,56");
    expect(formatDecimalBr("8400")).toBe("8.400");
  });

  it("lê frete com separador de milhar nas duas convenções", () => {
    const opts = { groupThousands: true };
    expect(formatDecimalBr("8,400", opts)).toBe("8.400");
    expect(formatDecimalBr("8.400", opts)).toBe("8.400");
    expect(formatDecimalBr("8400", opts)).toBe("8.400");
    expect(formatDecimalBr("1.594,00", opts)).toBe("1.594,00");
    expect(formatDecimalBr("1594.00", opts)).toBe("1.594,00");
  });

  it("lê peso bruto com milhar quando não há decimais", () => {
    const opts = { groupThousands: true };
    expect(formatDecimalBr("29,398", opts)).toBe("29.398");
    expect(formatDecimalBr("29398", opts)).toBe("29.398");
    // Formato com decimais do BL continua preservado.
    expect(formatDecimalBr("40,093.200", opts)).toBe("40.093,200");
    expect(formatDecimalBr("136,5", opts)).toBe("136,5");
  });
});

describe("normalizeIntegerBr", () => {
  it("remove separadores e devolve inteiro", () => {
    expect(normalizeIntegerBr("2,664")).toBe("2664");
    expect(normalizeIntegerBr("2.664")).toBe("2664");
    expect(normalizeIntegerBr(" 2 ")).toBe("2");
  });
});

describe("normalizeDateBr", () => {
  it("converte para DD/MM/AAAA", () => {
    expect(normalizeDateBr("OCT/01/2026")).toBe("01/10/2026");
    expect(normalizeDateBr("2026-10-01T10:00:00Z")).toBe("01/10/2026");
    expect(normalizeDateBr("02/11/2026")).toBe("02/11/2026");
  });
});

describe("normalizeContainerType", () => {
  it("separa quantidade e tipo", () => {
    expect(normalizeContainerType("2X40 HC")).toBe("40 HC");
    expect(normalizeContainerType("40hc")).toBe("40 HC");
  });
});

describe("normalizeDescription", () => {
  it("remove o boilerplate do BL", () => {
    expect(
      normalizeDescription("TOILET (SHIPPER'S LOAD AND COUNT / SAID TO CONTAIN)"),
    ).toBe("TOILET");
    expect(
      normalizeDescription("GABIONS - SEE THE ATTACHED RIDER"),
    ).toBe("GABIONS");
  });

  it("remove a cauda de NCM/embalagem de madeira (rider)", () => {
    expect(
      normalizeDescription(
        "GLASS DOOR AND SPARE PARTS FOR FREEZER NCM:8418 WOODEN PACKAGE: NOT APPLICABLE NOT USED",
      ),
    ).toBe("GLASS DOOR AND SPARE PARTS FOR FREEZER");
  });
});

describe("normalizeCarrier", () => {
  it("troca forwarder pelo armador do navio", () => {
    expect(
      normalizeCarrier(
        "LX PANTOS LOGISTICS (SHENZHEN) CO., LTD.",
        "CMA CGM KRYPTON",
        ["TCNU2640912"],
      ),
    ).toBe("CMA CGM");
  });

  it("infere Hapag pelo container quando o navio não identifica", () => {
    expect(
      normalizeCarrier("YQN SOUTH-LOGISTICS", "NAVEGANTES EXPRESS", [
        "HLBU9334723",
      ]),
    ).toBe("HAPAG-LLOYD");
  });

  it("mantém armador já identificado", () => {
    expect(normalizeCarrier("MAERSK LINE", "MSC AURORA", [])).toBe(
      "MAERSK LINE",
    );
  });
});

describe("normalizeBlExtraction", () => {
  it("normaliza o BL OYH120 (casa + rider)", () => {
    const bl = normalizeBlExtraction({
      ...blOych120(),
      masterBlNumber: " hlcU sha 2502baxd3 ",
    });

    expect(bl.carrier).toBe("CMA CGM");
    expect(bl.masterBlNumber).toBe("HLCUSHA2502BAXD3");
    expect(bl.grossWeight).toBe("40.093,200");
    expect(bl.volumes).toBe("2664");
    expect(bl.measurement).toBe("136,000");
    expect(bl.freightValue).toBe("8.400");
    expect(bl.freightCurrency).toBe("USD");
    expect(bl.freeTime).toBe("21 DIAS");
    expect(bl.containerQuantity).toBe("2");
    expect(bl.containerType).toBe("40 HC");
    expect(bl.descriptionOfGoods).toBe("TOILET");
    expect(bl.onboardDate).toBe("01/10/2026");
    expect(bl.eta).toBeNull();
  });
});

describe("masterBlFromText", () => {
  it("lê MASTER B/L, MBL e OCEAN B/L no markdown", () => {
    expect(masterBlFromText("MASTER B/L NO.: HLCUSHA2502BAXD3")).toBe(
      "HLCUSHA2502BAXD3",
    );
    expect(masterBlFromText("MBL NO. MAEU123456789")).toBe("MAEU123456789");
    expect(masterBlFromText("OCEAN B/L: MEDU1234567")).toBe("MEDU1234567");
  });

  it("devolve null sem master ou quando o valor não parece um número", () => {
    expect(masterBlFromText("BILL OF LADING: SASE3388881")).toBeNull();
    expect(masterBlFromText("MASTER BILL OF LADING")).toBeNull();
    expect(masterBlFromText("MBL NO.: ABCDEFGHI")).toBeNull();
  });
});

const MARKDOWN_OYH120 = `ATTACHED RIDER
VESSEL : CMA CGM KRYPTON 0BDPFW1MA BL : PLISZ4H14434

DESCRIPTION OF GOODS
TOILET

NCM CODE:6910
WOODEN PACKING: NOT APPLICABLE

OFT:USD 8400
THD: BRL 1594.00
FREE TIME: 21 DAYS

END OF RIDER
`;

const MARKDOWN_OYH120_HOME = `<table><tbody><tr><td rowspan="2">TCNU2640912/J2697782
(20,046.600KG/68.000M3/1332)/
TCNU6779444/J2697787
(20,046.600KG/68.000M3/1332)/
N/M</td><td rowspan="2">2X40 HC
2,664
CARTONS</td><td colspan="2">SHIPPER'S LOAD AND COUNT
SAID TO CONTAIN
<sup>*</sup>SEE THE ATTACHED RIDER</td><td rowspan="2">KGS
40,093.200</td><td rowspan="2">CBM(M3)
136.000</td></tr><tr><td colspan="2">FREIGHT PREPAID
SAY : TWO (40HCX2) CONTAINERS ONLY.</td></tr><tr><td colspan="3">NO OF ORIGINAL B/L THREE(3)</td><td colspan="2">PLACE AND DATE OF ISSUE SHENZHEN,CHINA OCT/01/2026</td><td>ON BOARD DATE OCT/01/2026</td></tr></tbody></table>`;


describe("applyMarkdownFallbacks", () => {
  it("devolve o BL intacto quando o markdown está vazio", () => {
    const bl = blOych120();
    expect(applyMarkdownFallbacks(bl, " \n ")).toBe(bl);
  });

  it("preenche os campos que a IA deixou nulos", () => {
    const semNumeros: BlExtraction = {
      ...blOych120(),
      grossWeight: null,
      measurement: null,
      volumes: null,
      containerQuantity: null,
      containerType: null,
      freightValue: null,
      freightCurrency: null,
      freeTime: null,
      onboardDate: null,
      descriptionOfGoods: null,
      containerNumbers: [],
      ncm: [],
    };

    const bl = applyMarkdownFallbacks(
      semNumeros,
      `${MARKDOWN_OYH120_HOME}\n\n---\n\n${MARKDOWN_OYH120}`,
    );

    expect(bl.grossWeight).toBe("40.093,200");
    expect(bl.measurement).toBe("136,000");
    expect(bl.volumes).toBe("2664");
    expect(bl.containerQuantity).toBe("2");
    expect(bl.containerType).toBe("40 HC");
    expect(bl.freightValue).toBe("8.400");
    expect(bl.freightCurrency).toBe("USD");
    expect(bl.freeTime).toBe("21 DIAS");
    expect(bl.onboardDate).toBe("01/10/2026");
    expect(bl.descriptionOfGoods).toBe("TOILET");
    expect(bl.containerNumbers).toEqual(["TCNU2640912", "TCNU6779444"]);
    expect(bl.ncm).toEqual(["6910"]);
  });

  it("não sobrescreve valores já extraídos", () => {
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), grossWeight: "11,111.000" },
      MARKDOWN_OYH120,
    );
    expect(bl.grossWeight).toBe("11.111,000");
  });

  it("preenche o master BL pelo markdown quando a IA deixou vazio", () => {
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), masterBlNumber: null },
      `${MARKDOWN_OYH120_HOME}\nMASTER B/L NO.: HLCUSHA2502BAXD3`,
    );
    expect(bl.masterBlNumber).toBe("HLCUSHA2502BAXD3");
  });

  it("não sobrescreve o master BL já extraído", () => {
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), masterBlNumber: "MAEU123456789" },
      "MASTER B/L NO.: HLCUSHA2502BAXD3",
    );
    expect(bl.masterBlNumber).toBe("MAEU123456789");
  });

  it("não duplica o BL do documento como master", () => {
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), masterBlNumber: null },
      "MASTER B/L NO.: PLISZ4H14434",
    );
    expect(bl.masterBlNumber).toBeNull();
  });

  it("ignora a linha de traços antes da descrição (rider)", () => {
    const markdown = `DESCRIPTION OF GOODS
--------------------------------------------------------

TOILET

NCM CODE:6910
`;
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), descriptionOfGoods: null },
      markdown,
    );
    expect(bl.descriptionOfGoods).toBe("TOILET");
  });
});
