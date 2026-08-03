import type { LanguageModelUsage } from "ai";

export type AiTaskUsage = {
  tokensIn: number;
  tokensOut: number;
  reasoningTokens: number;
  costUsd: number | null;
  latencyMs: number;
};

type UsageResult = {
  usage?: LanguageModelUsage;
  providerMetadata?: unknown;
};

type OpenRouterProviderMetadata = {
  openrouter?: {
    usage?: {
      cost?: number;
    };
  };
};

function readOpenRouterCost(providerMetadata: unknown): number | null {
  const metadata = providerMetadata as OpenRouterProviderMetadata | undefined;
  const cost = metadata?.openrouter?.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
}

export function extractAiTaskUsage(
  result: UsageResult,
  latencyMs: number,
): AiTaskUsage {
  return {
    tokensIn: result.usage?.inputTokens ?? 0,
    tokensOut: result.usage?.outputTokens ?? 0,
    reasoningTokens: result.usage?.outputTokenDetails?.reasoningTokens ?? 0,
    costUsd: readOpenRouterCost(result.providerMetadata),
    latencyMs,
  };
}

export function sumAiTaskUsage(usages: AiTaskUsage[]): AiTaskUsage {
  const total = usages.reduce(
    (acc, usage) => ({
      tokensIn: acc.tokensIn + usage.tokensIn,
      tokensOut: acc.tokensOut + usage.tokensOut,
      reasoningTokens: acc.reasoningTokens + usage.reasoningTokens,
      costUsd:
        usage.costUsd == null
          ? acc.costUsd
          : acc.costUsd == null
            ? usage.costUsd
            : acc.costUsd + usage.costUsd,
      latencyMs: acc.latencyMs + usage.latencyMs,
    }),
    {
      tokensIn: 0,
      tokensOut: 0,
      reasoningTokens: 0,
      costUsd: null as number | null,
      latencyMs: 0,
    },
  );

  return total;
}
