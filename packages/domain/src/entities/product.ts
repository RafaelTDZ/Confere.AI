export const PRODUCT_ORIGINS = ["manual", "ai"] as const;

export type ProductOrigin = (typeof PRODUCT_ORIGINS)[number];

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  description: string;
  ncm: string | null;
  unitWeight: number | null;
  unitOfMeasure: string | null;
  attributes: Record<string, unknown>;
  origin: ProductOrigin;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProduct {
  tenantId: string;
  sku: string;
  description: string;
  ncm?: string | null;
  unitWeight?: number | null;
  unitOfMeasure?: string | null;
  attributes?: Record<string, unknown>;
  origin: ProductOrigin;
}

/** Normaliza descricao para comparacao fuzzy deterministica. */
export function normalizeDescription(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similaridade de Jaccard sobre tokens normalizados (0..1). */
export function descriptionSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeDescription(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeDescription(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
