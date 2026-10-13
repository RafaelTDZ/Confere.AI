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

type ProviderMetadata = {
  openrouter?: {
    usage?: {
      cost?: number;
    };
  };
  fireworks?: {
    usage?: {
      cost?: number;
    };
  };
};

function readProviderCost(providerMetadata: unknown): number | null {
  const metadata = providerMetadata as ProviderMetadata | undefined;
  const cost =
    metadata?.openrouter?.usage?.cost ?? metadata?.fireworks?.usage?.cost;
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
    costUsd: readProviderCost(result.providerMetadata),
    latencyMs,
  };
}
