import { describe, expect, it } from "vitest";
import type { BlExtraction } from "@/lib/ai/schemas";
import {
  applyMarkdownFallbacks,
  blNumberInText,
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
    descriptionOfGoods: "TOILET (SHIPPER'S LOAD AND COUNT / SAID TO CONTAIN)",
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

  it("não infla o peso quando o BL usa 3 casas decimais", () => {
    const opts = { groupThousands: true, decimals: 2 };
    // "138631.600KGS" é 138.631,6 kg, não 138.631.600 kg.
    expect(formatDecimalBr("138631.600", opts)).toBe("138.631,60");
    expect(formatDecimalBr("110905.280", opts)).toBe("110.905,28");
    // Separador curto continua sendo milhar.
    expect(formatDecimalBr("29,398", opts)).toBe("29.398,00");
    expect(formatDecimalBr("136.000", opts)).toBe("136.000,00");
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
      normalizeDescription(
        "TOILET (SHIPPER'S LOAD AND COUNT / SAID TO CONTAIN)",
      ),
    ).toBe("TOILET");
    expect(normalizeDescription("GABIONS - SEE THE ATTACHED RIDER")).toBe(
      "GABIONS",
    );
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

  it("mantém a Kuehne + Nagel (portal myKN rastreia o BL de casa)", () => {
    // A K+N é agente de carga, mas o BL emitido por ela é consultável no portal
    // público; trocar pelo armador oceânico perderia a consulta pelo BL.
    expect(
      normalizeCarrier("Kuehne + Nagel Ltd.", "MSC AURORA", ["MSGU6161889"]),
    ).toBe("KUEHNE + NAGEL LTD.");
    // O nome com "Logistics" também não cai no FORWARDER_RE.
    expect(
      normalizeCarrier("Kuehne + Nagel Logistics", "MSC AURORA", [
        "MSGU6161889",
      ]),
    ).toBe("KUEHNE + NAGEL LOGISTICS");
  });

  it("reconhece o BL emitido pela Kuehne + Nagel mesmo com navio da Maersk", () => {
    // BL real 1077603444: título "Blue Anchor Line Bill of Lading" e a K+N como
    // delivery agent "as agent for Blue Anchor Line", mas o navio é da Maersk.
    const markdown = [
      "Blue Anchor Line Bill of Lading for Multimodal and Port to Port Transport",
      "Delivery Agent KUEHNE+NAGEL SERVICOS LOGISTICOS LTDA. AS AGENT FOR BLUE ANCHOR LINE",
      "Vessel MAERSK SAN VINCENT",
    ].join("\n");

    expect(
      normalizeCarrier(
        "MAERSK",
        "MAERSK SAN VINCENT",
        ["HAMU1578596", "GCXU5197277"],
        markdown,
      ),
    ).toBe("KUEHNE + NAGEL");
  });

  it("não confunde a K+N citada como agente de entrega com o emitente", () => {
    // BL da Maersk que só cita a K+N como delivery agent (sem Blue Anchor).
    const markdown = [
      "MAERSK BILL OF LADING",
      "Delivery Agent KUEHNE+NAGEL LTDA",
      "Vessel MAERSK SAN VINCENT",
    ].join("\n");

    expect(normalizeCarrier("MAERSK", "MAERSK SAN VINCENT", [], markdown)).toBe(
      "MAERSK",
    );
  });

  it("descarta armador que não aparece no documento (palpite do modelo)", () => {
    // OYH142: o modelo repetiu o exemplo do prompt (`CMA CGM`) num BL da MSC,
    // cujo texto só traz o navio `LE HAVRE` e os containers `MSGU...`.
    expect(
      normalizeCarrier(
        "CMA CGM",
        "LE HAVRE",
        ["TXTU4077041", "MSGU6161889"],
        "LX PANTOS LOGISTICS (QINGDAO) CO.,LTD.\nLE HAVRE\nQI640A\nTXTU4077041/MSGU6161889",
      ),
    ).toBe("MSC");
  });

  it("mantém o armador quando a marca está no texto do documento", () => {
    expect(
      normalizeCarrier(
        "CMA CGM",
        "LE HAVRE",
        ["TXTU4077041"],
        "EXPORTING VESSEL/VOYAGE\nCMA CGM ATLANTIC\nSE3060W19",
      ),
    ).toBe("CMA CGM");
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
    expect(bl.grossWeight).toBe("40.093,20");
    expect(bl.volumes).toBe("2664");
    expect(bl.measurement).toBe("136,00");
    expect(bl.freightValue).toBe("8.400,00");
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

    expect(bl.grossWeight).toBe("40.093,20");
    expect(bl.measurement).toBe("136,00");
    expect(bl.volumes).toBe("2664");
    expect(bl.containerQuantity).toBe("2");
    expect(bl.containerType).toBe("40 HC");
    expect(bl.freightValue).toBe("8.400,00");
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
    expect(bl.grossWeight).toBe("11.111,00");
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

  it("reconhece o BL emitido pela Kuehne + Nagel (Blue Anchor Line)", () => {
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), carrier: "MAERSK" },
      "Blue Anchor Line Bill of Lading for Multimodal and Port to Port Transport\nDelivery Agent KUEHNE+NAGEL SERVICOS LOGISTICOS LTDA. AS AGENT FOR BLUE ANCHOR LINE",
    );
    expect(bl.carrier).toBe("KUEHNE + NAGEL");
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

  it("mantém o número do BL quando ele aparece no texto", () => {
    const bl = applyMarkdownFallbacks(
      blOych120(),
      "PLISZ4H14434\nB/L No. 1 077 841 412",
    );
    expect(bl.number).toBe("PLISZ4H14434");
  });

  it("descarta número de BL que não está no texto (invenção do modelo)", () => {
    // NEX016: o fac-símile não traz o B/L No. e o modelo devolveu "NEXUS",
    // o nome que aparece no documento.
    const bl = applyMarkdownFallbacks(
      { ...blOych120(), number: "NEXUS" },
      "NEXUS\n915CARTONS\nSHIPPED ON BOARD",
    );
    expect(bl.number).toBeNull();
  });

  it("sobrevive a espaços e hífens do OCR no número do BL", () => {
    expect(blNumberInText("1077841412", "B/L No. 1 077 841 412")).toBe(true);
    expect(blNumberInText("PLISZ4H16849", "PLISZ-4H16849")).toBe(true);
    expect(blNumberInText("1077841412", "B/L No. 1077841413")).toBe(false);
    expect(blNumberInText("NEXUS", "NEXUS")).toBe(false);
    expect(blNumberInText(null, "qualquer")).toBe(false);
  });
});
