import type { DocumentExtraction } from "../entities/document-extraction.js";
import type { Finding } from "../entities/analysis.js";
import { quantityEquals } from "../value-objects/money.js";
import { normalizeSku } from "../value-objects/identifiers.js";
import { descriptionSimilarity } from "../entities/product.js";

const MIN_DESCRIPTION_SIMILARITY = 0.6;

interface ComparedPair {
  label: string;
  a: DocumentExtraction;
  b: DocumentExtraction;
}

/**
 * Comparacao deterministica entre as extracoes dos documentos.
 * Roda antes/depois da IA e garante um piso de validacao explicavel.
 */
export function compareExtractions(
  extractions: DocumentExtraction[],
): Finding[] {
  const findings: Finding[] = [];
  const byType = new Map(extractions.map((e) => [e.docType, e]));

  const invoice = byType.get("invoice");
  const packingList = byType.get("packing_list");
  const bl = byType.get("bill_of_lading");

  const pairs: ComparedPair[] = [];
  if (invoice && packingList)
    pairs.push({ label: "Invoice x Packing List", a: invoice, b: packingList });
  if (packingList && bl)
    pairs.push({ label: "Packing List x BL", a: packingList, b: bl });
  if (invoice && bl) pairs.push({ label: "Invoice x BL", a: invoice, b: bl });

  for (const pair of pairs) {
    findings.push(...compareTotals(pair));
    findings.push(...compareItems(pair));
  }

  return findings;
}

function compareTotals({ label, a, b }: ComparedPair): Finding[] {
  const findings: Finding[] = [];

  if (a.totalQuantity != null && b.totalQuantity != null) {
    if (!quantityEquals(a.totalQuantity, b.totalQuantity)) {
      findings.push({
        field: "total_quantity",
        message: `${label}: quantidade total diverge`,
        severity: "critical",
        expected: a.totalQuantity,
        actual: b.totalQuantity,
        suggestion: "Conferir embarque fisico e documentos com o fornecedor",
      });
    }
  }

  if (a.totalGrossWeight != null && b.totalGrossWeight != null) {
    if (!quantityEquals(a.totalGrossWeight, b.totalGrossWeight, 0.01)) {
      findings.push({
        field: "total_gross_weight",
        message: `${label}: peso bruto total diverge`,
        severity: "warning",
        expected: a.totalGrossWeight,
        actual: b.totalGrossWeight,
        suggestion: "Validar pesagem e tolerancias de embalagem",
      });
    }
  }

  return findings;
}

function compareItems({ label, a, b }: ComparedPair): Finding[] {
  const findings: Finding[] = [];
  const itemsA = new Map(
    a.items.map((item) => [safeSku(item.sku), item] as const),
  );
  const itemsB = new Map(
    b.items.map((item) => [safeSku(item.sku), item] as const),
  );

  for (const [sku, itemA] of itemsA) {
    if (!sku) continue;
    const itemB = itemsB.get(sku);
    if (!itemB) {
      findings.push({
        field: "item_presence",
        message: `${label}: item ${sku} presente em ${a.docType} mas ausente em ${b.docType}`,
        severity: "critical",
        expected: sku,
        actual: null,
        suggestion: "Confirmar se o item foi embarcado ou se ha erro de digitacao",
      });
      continue;
    }

    if (!quantityEquals(itemA.quantity, itemB.quantity)) {
      findings.push({
        field: `item_quantity:${sku}`,
        message: `${label}: quantidade do item ${sku} diverge`,
        severity: "critical",
        expected: itemA.quantity,
        actual: itemB.quantity,
        suggestion: "Revisar quantidade junto ao fornecedor",
      });
    }

    const similarity = descriptionSimilarity(
      itemA.description,
      itemB.description,
    );
    if (similarity < MIN_DESCRIPTION_SIMILARITY) {
      findings.push({
        field: `item_description:${sku}`,
        message: `${label}: descricao do item ${sku} diverge (similaridade ${(similarity * 100).toFixed(0)}%)`,
        severity: "warning",
        expected: itemA.description,
        actual: itemB.description,
        suggestion: "Padronizar a descricao comercial do produto",
      });
    }
  }

  for (const [sku] of itemsB) {
    if (sku && !itemsA.has(sku)) {
      findings.push({
        field: "item_presence",
        message: `${label}: item ${sku} presente em ${b.docType} mas ausente em ${a.docType}`,
        severity: "critical",
        expected: null,
        actual: sku,
        suggestion: "Confirmar se o item foi embarcado ou se ha erro de digitacao",
      });
    }
  }

  return findings;
}

function safeSku(sku: string): string | null {
  try {
    return normalizeSku(sku);
  } catch {
    return null;
  }
}
