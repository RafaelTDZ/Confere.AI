import { describe, expect, it } from "vitest";
import { recordAiCall, withSpan } from "@/lib/observability/tracing";

describe("withSpan", () => {
  it("devolve o resultado e entrega o span ao callback", async () => {
    const result = await withSpan(
      "test.span",
      { "tenant.id": "tenant-1" },
      async (span) => {
        span.setAttribute("test.ok", true);
        return 42;
      },
    );

    expect(result).toBe(42);
  });

  it("propaga o erro original", async () => {
    await expect(
      withSpan("test.span", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("recordAiCall", () => {
  it("registra duração, tokens e custo sem provider configurado", () => {
    expect(() =>
      recordAiCall({
        capability: "classify",
        model: "model-x",
        status: "success",
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 120,
        costUsd: 0.01,
      }),
    ).not.toThrow();
  });

  it("aceita erro sem custo informado", () => {
    expect(() =>
      recordAiCall({
        capability: "extract_invoice",
        model: "model-x",
        status: "error",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 5,
      }),
    ).not.toThrow();
  });
});
