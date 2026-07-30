import { describe, expect, it } from "vitest";
import { compareExtractions } from "./compare-documents.js";
import type { DocumentExtraction } from "../entities/document-extraction.js";

function baseExtraction(): DocumentExtraction {
  return {
    docType: "invoice",
    documentNumber: "INV-1",
    issueDate: "2026-07-01",
    supplierName: "Fornecedor X",
    buyerName: "Cliente Y",
    incoterm: "FOB",
    currency: "USD",
    totalQuantity: 100,
    totalNetWeight: 500,
    totalGrossWeight: 550,
    totalValue: 10000,
    items: [
      {
        sku: "ABC-123",
        description: "Motor eletrico 220V",
        quantity: 100,
        unitOfMeasure: "UN",
        unitWeight: 5,
        unitPrice: 100,
        ncm: "85013110",
        attributes: {},
      },
    ],
  };
}

describe("compareExtractions", () => {
  it("nao gera findings quando documentos sao consistentes", () => {
    const invoice = baseExtraction();
    const packingList: DocumentExtraction = {
      ...baseExtraction(),
      docType: "packing_list",
    };
    const findings = compareExtractions([invoice, packingList]);
    expect(findings).toHaveLength(0);
  });

  it("gera finding critical quando quantidade diverge", () => {
    const invoice = baseExtraction();
    const packingList: DocumentExtraction = {
      ...baseExtraction(),
      docType: "packing_list",
      totalQuantity: 90,
      items: [{ ...baseExtraction().items[0]!, quantity: 90 }],
    };
    const findings = compareExtractions([invoice, packingList]);
    expect(
      findings.some(
        (f) => f.severity === "critical" && f.field.includes("quantity"),
      ),
    ).toBe(true);
  });

  it("gera finding quando item existe apenas em um documento", () => {
    const invoice = baseExtraction();
    const packingList: DocumentExtraction = {
      ...baseExtraction(),
      docType: "packing_list",
      items: [
        {
          sku: "XYZ-999",
          description: "Outro produto",
          quantity: 100,
          unitOfMeasure: "UN",
          unitWeight: 5,
          unitPrice: 100,
          ncm: null,
          attributes: {},
        },
      ],
    };
    const findings = compareExtractions([invoice, packingList]);
    expect(findings.filter((f) => f.field === "item_presence")).toHaveLength(2);
  });
});
