import type { Product } from "../entities/product.js";
import { descriptionSimilarity } from "../entities/product.js";
import type {
  ExtractedItem,
  FieldDifference,
  MatchStatus,
} from "../entities/product-match.js";
import { normalizeSku } from "../value-objects/identifiers.js";
import { isValidNcm } from "../value-objects/identifiers.js";
import { quantityEquals } from "../value-objects/money.js";

const FUZZY_DESCRIPTION_THRESHOLD = 0.85;

export interface MatchDecision {
  status: MatchStatus;
  product: Product | null;
  differences: FieldDifference[];
  similarity: number;
}

/**
 * Decide se um item extraido corresponde a um produto do catalogo.
 * Prioridade: SKU exato > descricao fuzzy acima do threshold > novo.
 */
export function decideProductMatch(
  item: ExtractedItem,
  candidates: Product[],
): MatchDecision {
  let sku: string | null = null;
  try {
    sku = normalizeSku(item.sku);
  } catch {
    sku = null;
  }

  const exact = sku
    ? candidates.find((p) => normalizeSku(p.sku) === sku)
    : undefined;
  if (exact) {
    return {
      status: "existing_match",
      product: exact,
      differences: diffAgainstCatalog(item, exact),
      similarity: 1,
    };
  }

  let best: Product | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = descriptionSimilarity(
      item.description,
      candidate.description,
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore >= FUZZY_DESCRIPTION_THRESHOLD) {
    return {
      status: "divergent",
      product: best,
      differences: diffAgainstCatalog(item, best),
      similarity: bestScore,
    };
  }

  return { status: "new", product: null, differences: [], similarity: bestScore };
}

/** Campos do item extraido que divergem do cadastro existente. */
export function diffAgainstCatalog(
  item: ExtractedItem,
  product: Product,
): FieldDifference[] {
  const differences: FieldDifference[] = [];

  if (
    descriptionSimilarity(item.description, product.description) <
    FUZZY_DESCRIPTION_THRESHOLD
  ) {
    differences.push({
      field: "description",
      catalogValue: product.description,
      extractedValue: item.description,
    });
  }

  if (item.ncm && product.ncm && isValidNcm(item.ncm)) {
    if (item.ncm !== product.ncm) {
      differences.push({
        field: "ncm",
        catalogValue: product.ncm,
        extractedValue: item.ncm,
      });
    }
  }

  if (item.unitWeight != null && product.unitWeight != null) {
    if (!quantityEquals(item.unitWeight, product.unitWeight, 0.02)) {
      differences.push({
        field: "unit_weight",
        catalogValue: product.unitWeight,
        extractedValue: item.unitWeight,
      });
    }
  }

  if (
    item.unitOfMeasure &&
    product.unitOfMeasure &&
    item.unitOfMeasure.toUpperCase() !== product.unitOfMeasure.toUpperCase()
  ) {
    differences.push({
      field: "unit_of_measure",
      catalogValue: product.unitOfMeasure,
      extractedValue: item.unitOfMeasure,
    });
  }

  return differences;
}
