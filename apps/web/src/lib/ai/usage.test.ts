import type { LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";

import { extractAiTaskUsage } from "@/lib/ai/usage";

function criacaoDeUso(params: {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}): LanguageModelUsage {
  return {
    inputTokens: params.inputTokens,
    inputTokenDetails: {
      noCacheTokens: params.inputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: params.outputTokens,
    outputTokenDetails: {
      textTokens: params.outputTokens,
      reasoningTokens: params.reasoningTokens,
    },
    totalTokens:
      (params.inputTokens ?? 0) +
      (params.outputTokens ?? 0) +
      (params.reasoningTokens ?? 0),
  };
}

describe("extractAiTaskUsage", () => {
  it("mapeia tokens, reasoning, custo e latência", () => {
    const resultado = {
      usage: criacaoDeUso({
        inputTokens: 120,
        outputTokens: 80,
        reasoningTokens: 30,
      }),
      providerMetadata: {
        openrouter: {
          usage: {
            cost: 0.0123,
          },
        },
      },
    };

    expect(extractAiTaskUsage(resultado, 456)).toEqual({
      tokensIn: 120,
      tokensOut: 80,
      reasoningTokens: 30,
      costUsd: 0.0123,
      latencyMs: 456,
    });
  });

  it("usa zero quando usage está ausente", () => {
    expect(extractAiTaskUsage({}, 10)).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      reasoningTokens: 0,
      costUsd: null,
      latencyMs: 10,
    });
  });

  it("usa zero quando os campos de usage são undefined", () => {
    const resultado = {
      usage: criacaoDeUso({}),
    };

    expect(extractAiTaskUsage(resultado, 0)).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      reasoningTokens: 0,
      costUsd: null,
      latencyMs: 0,
    });
  });

  it("retorna custo null quando providerMetadata está ausente", () => {
    const resultado = {
      usage: criacaoDeUso({ inputTokens: 1, outputTokens: 2 }),
    };

    expect(extractAiTaskUsage(resultado, 1).costUsd).toBeNull();
  });

  it("retorna custo null quando o caminho do custo não existe", () => {
    const resultado = {
      usage: criacaoDeUso({}),
      providerMetadata: { openrouter: { usage: {} } },
    };

    expect(extractAiTaskUsage(resultado, 1).costUsd).toBeNull();
    expect(
      extractAiTaskUsage({ providerMetadata: { outro: {} } }, 1).costUsd,
    ).toBeNull();
  });

  it("aceita custo zero como válido", () => {
    const resultado = {
      providerMetadata: { openrouter: { usage: { cost: 0 } } },
    };

    expect(extractAiTaskUsage(resultado, 1).costUsd).toBe(0);
  });

  it.each([
    ["string", "0.5"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("retorna custo null para custo inválido (%s)", (_rotulo, cost) => {
    const resultado = {
      providerMetadata: { openrouter: { usage: { cost } } },
    };

    expect(extractAiTaskUsage(resultado, 1).costUsd).toBeNull();
  });
});
