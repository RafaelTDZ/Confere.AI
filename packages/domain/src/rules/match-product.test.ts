import { describe, expect, it } from "vitest";
import { decideProductMatch, diffAgainstCatalog } from "./match-product.js";
import type { Product } from "../entities/product.js";
import type { ExtractedItem } from "../entities/product-match.js";

function product(partial: Partial<Product>): Product {
  return {
    id: "p1",
    tenantId: "t1",
    sku: "ABC-123",
    description: "Motor eletrico 220V trifasico",
    ncm: "85013110",
    unitWeight: 5,
    unitOfMeasure: "UN",
    attributes: {},
    origin: "manual",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function item(partial: Partial<ExtractedItem>): ExtractedItem {
  return {
    sku: "abc-123",
    description: "MOTOR ELETRICO 220V TRIFASICO",
    quantity: 10,
    unitOfMeasure: "UN",
    unitWeight: 5,
    unitPrice: 100,
    ncm: "85013110",
    attributes: {},
    ...partial,
  };
}

describe("decideProductMatch", () => {
  it("SKU exato (case-insensitive) gera existing_match", () => {
    const decision = decideProductMatch(item({}), [product({})]);
    expect(decision.status).toBe("existing_match");
    expect(decision.product?.id).toBe("p1");
    expect(decision.differences).toHaveLength(0);
  });

  it("descricao quase identica sem SKU gera divergent acima do threshold", () => {
    const decision = decideProductMatch(
      item({
        sku: "OUTRO-1",
        description: "Motor eletrico 220V trifasico 60Hz IP55 WEG",
      }),
      [product({ description: "Motor eletrico 220V trifasico 60Hz IP55" })],
    );
    expect(decision.status).toBe("divergent");
    expect(decision.product?.id).toBe("p1");
  });

  it("sem similaridade gera new", () => {
    const decision = decideProductMatch(
      item({ sku: "NOVO-9", description: "Bomba hidraulica 10cv" }),
      [product({})],
    );
    expect(decision.status).toBe("new");
    expect(decision.product).toBeNull();
  });
});

describe("diffAgainstCatalog", () => {
  it("aponta divergencia de NCM e peso", () => {
    const diffs = diffAgainstCatalog(
      item({ ncm: "85013210", unitWeight: 8 }),
      product({}),
    );
    expect(diffs.map((d) => d.field)).toContain("ncm");
    expect(diffs.map((d) => d.field)).toContain("unit_weight");
  });

  it("nao aponta divergencias quando dados sao consistentes", () => {
    const diffs = diffAgainstCatalog(item({}), product({}));
    expect(diffs).toHaveLength(0);
  });
});
