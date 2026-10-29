import { describe, expect, it } from "vitest";
import {
  detectDocumentTypes,
  preparedDocumentText,
} from "@/lib/ai/document-type-heuristic";

const BL_OYH128 = `
<table><thead><tr><th>SHIPPER/EXPORTER OYH INTERNATIONAL TRADE (SHANGHAI) CO., LTD.</th><th>BL NO. PLISZ4H16237</th></tr></thead>
<tbody><tr><td>EXPORTING VESSEL/VOYAGE CMA CGM THORIUM 0BDPJW1MA</td><td>PORT OF LOADING SHEKOU</td></tr>
<tr><td>SEKU6495765/J2899339 (19,788.000KG/67.980M3/388)/TCLU8257987/J2884591</td><td>2X40 HC 776 CARTONS</td>
<td>SHIPPER'S LOAD AND COUNT SAID TO CONTAIN * SEE THE ATTACHED RIDER</td></tr>
<tr><td>KGS 39,576.000</td><td>CBM(M3) 135.960</td></tr>
<tr><td>THREE(3) BILLS OF LADING ALL OF THE SAME TENOR AND DATE</td></tr></tbody></table>
DESCRIPTION OF GOODS
TOILET
NCM CODE:6910
OFT:USD 8400
FREE TIME: 21 DAYS
`;

const INVOICE_E_PACKING_LIST = `
# OYH International Trade (Shanghai) Co., Ltd.
## COMMERCIAL INVOICE
INVOICE NO.: CN022608190005
INVOICE DATE: 2026/10/9
<table><thead><tr><th>DESCRIPTIONS</th><th>HS CODE</th><th>QUANTITES</th></tr></thead>
<tbody><tr><td>TOILET</td><td>6910100000</td><td>666</td></tr></tbody></table>

## PACKING LIST
TOTAL: 2,664 CARTONS
`;

describe("detectDocumentTypes", () => {
  it("reconhece o BL pelo cabeçalho, sem chamar IA", () => {
    const result = detectDocumentTypes({ text: BL_OYH128 });

    expect(result?.types).toEqual(["bill_of_lading"]);
    expect(result?.matches).toContain("bl no");
  });

  it("reconhece Invoice + Packing List no mesmo PDF", () => {
    const result = detectDocumentTypes({ text: INVOICE_E_PACKING_LIST });

    expect(result?.types).toEqual(["invoice", "packing_list"]);
  });

  it("não confunde BL que cita INVOICE NO. com uma invoice", () => {
    const result = detectDocumentTypes({
      text: `
        BILL OF LADING
        BL NO. ABC123456
        INVOICE NO.: 998877
        PORT OF LOADING SHEKOU
      `,
    });

    expect(result?.types).toEqual(["bill_of_lading"]);
  });

  it("devolve null quando não há marcador forte (cai no modelo)", () => {
    expect(detectDocumentTypes({ text: "" })).toBeNull();
    expect(
      detectDocumentTypes({ text: "Documento escaneado sem cabeçalho legível" }),
    ).toBeNull();
  });

  it("considera o texto em qualquer caixa e com espaços quebrados", () => {
    const result = detectDocumentTypes({
      text: "commercial\n\n   invoice",
    });
    expect(result?.types).toEqual(["invoice"]);
  });

  it("ignora 'commercial invoice' no clausulado do BL (FRI009)", () => {
    const filler = "clausula do conhecimento sem marcador de tipo\n".repeat(60);
    const boilerplate =
      "The Carrier shall be entitled to production of the commercial invoice for the Goods or true copy thereof and to inspect reweigh, remeasure and revalue the Goods. ".repeat(
        5,
      );
    const result = detectDocumentTypes({
      text: `Shipper\nZHEJIANG XINGXING REFRIGERATION\nBILL OF LADING Not negotiable unless consigned to order\nVessel HMM DIAMOND / 0012E\n${filler}\n${boilerplate}`,
    });

    expect(result?.types).toEqual(["bill_of_lading"]);
  });

  it("aceita um tipo que aparece como título no meio de um documento longo", () => {
    const filler = "linha de termos e condicoes sem marcador\n".repeat(400);
    const result = detectDocumentTypes({
      text: `## COMMERCIAL INVOICE\nINVOICE NO.: 1\n${filler}\n## PACKING LIST\n609 CARTONS`,
    });

    expect(result?.types).toEqual(["invoice", "packing_list"]);
  });
});

describe("preparedDocumentText", () => {
  it("junta apenas as partes de texto", () => {
    expect(
      preparedDocumentText([
        { type: "text", text: "a" },
        { type: "file" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("devolve vazio quando o documento é só arquivo (PDF/imagem)", () => {
    expect(preparedDocumentText([{ type: "file" }])).toBe("");
  });
});
