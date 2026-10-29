import { describe, expect, it } from "vitest";
import { extractImportReference } from "@/lib/documents/import-reference";

describe("extractImportReference", () => {
  it("usa o campo EXPORT REFERENCES do documento", () => {
    const result = extractImportReference({
      markdown: "EXPORT REFERENCES\nPO-2026-001\nCONSIGNEE ...",
      filename: "documento.pdf",
    });

    expect(result).toEqual({ value: "PO-2026-001", source: "document" });
  });

  it("usa CONTRACT NO. quando não repete o número da Invoice", () => {
    const result = extractImportReference({
      markdown: "CONTRACT NO.: OYH-9001\nINVOICE NO.: CN022608190005",
      invoiceNumber: "CN022608190005",
    });

    expect(result).toEqual({ value: "OYH-9001", source: "document" });
  });

  it("ignora referência que só repete o número da Invoice", () => {
    const result = extractImportReference({
      markdown: "CONTRACT NO.: CN022608190005",
      filename: "OYH120 invoice e packing list - 09-10-2026.pdf",
      invoiceNumber: "CN022608190005",
    });

    expect(result).toEqual({ value: "OYH120", source: "filename" });
  });

  it("cai no código do nome do arquivo quando o documento não traz nada", () => {
    const result = extractImportReference({
      markdown:
        '<table><thead><tr><th colspan="2">EXPORT REFERENCES</th></tr></thead></table>',
      filename: "OYH128 draft bl - 15-10-2026.pdf",
    });

    expect(result).toEqual({ value: "OYH128", source: "filename" });
  });

  it("ignora valores vazios ou genéricos", () => {
    expect(
      extractImportReference({
        markdown: "EXPORT REFERENCES N/A",
        filename: "invoice.pdf",
      }),
    ).toBeNull();
    expect(extractImportReference({ filename: "documento.pdf" })).toBeNull();
  });

  it("ignora 'incorporated by reference' no clausulado do BL (FRI009)", () => {
    const boilerplate = `${"termos e condicoes do conhecimento de embarque. ".repeat(150)}
The provisions of any applicable Carrier's Tariff are incorporated by reference in this Bill of lading.
Copies of such provisions are obtainable upon request from the Carrier or his agent.`;

    const result = extractImportReference({
      markdown: boilerplate,
      filename: "FRI009 bl - 28-10-2026.pdf",
    });

    expect(result).toEqual({ value: "FRI009", source: "filename" });
  });

  it("não usa o código do arquivo quando ele é o próprio número do BL", () => {
    const result = extractImportReference({
      filename: "BL123456.pdf",
      blNumber: "BL123456",
    });

    expect(result).toBeNull();
  });
});
