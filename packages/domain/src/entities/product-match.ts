export const MATCH_STATUSES = [
  "new",
  "existing_match",
  "divergent",
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

export interface FieldDifference {
  field: string;
  catalogValue: string | number | null;
  extractedValue: string | number | null;
}

export interface ProductMatch {
  id: string;
  importId: string;
  tenantId: string;
  /** Nulo quando o produto nao existe no catalogo (cadastro novo). */
  productId: string | null;
  extractedData: ExtractedItem;
  matchStatus: MatchStatus;
  differences: FieldDifference[];
  createdAt: Date;
}

/** Item extraido de um documento de importacao pela IA. */
export interface ExtractedItem {
  sku: string;
  description: string;
  quantity: number;
  unitOfMeasure: string | null;
  unitWeight: number | null;
  unitPrice: number | null;
  ncm: string | null;
  attributes: Record<string, unknown>;
}
