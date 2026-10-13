export const DEFAULT_OPENROUTER_MODEL = "~openai/gpt-luna-latest";

export type OpenRouterReasoningEffort =
  | "xhigh"
  | "high"
  | "medium"
  | "low"
  | "none";

export type OpenRouterReasoningContext = "smoke" | "document" | "default";

export type OpenRouterReasoningConfig =
  | { effort: OpenRouterReasoningEffort; exclude?: boolean }
  | { max_tokens: number; exclude?: boolean };

const REASONING_PRESETS: Record<
  OpenRouterReasoningContext,
  OpenRouterReasoningConfig | undefined
> = {
  smoke: { effort: "none" },
  document: { effort: "low", exclude: true },
  default: { effort: "low", exclude: true },
};

export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

function parseReasoningEffort(
  value: string | undefined,
): OpenRouterReasoningEffort | undefined {
  if (!value) return undefined;
  const effort = value.trim().toLowerCase();
  if (
    effort === "xhigh" ||
    effort === "high" ||
    effort === "medium" ||
    effort === "low" ||
    effort === "none"
  ) {
    return effort;
  }
  return undefined;
}

function parseReasoningExclude(
  value: string | undefined,
): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

function parseReasoningMaxTokens(
  value: string | undefined,
): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function applyEnvOverrides(
  preset: OpenRouterReasoningConfig | undefined,
): OpenRouterReasoningConfig | undefined {
  const maxTokens = parseReasoningMaxTokens(
    process.env.OPENROUTER_REASONING_MAX_TOKENS,
  );
  const effort = parseReasoningEffort(process.env.OPENROUTER_REASONING_EFFORT);
  const exclude = parseReasoningExclude(process.env.OPENROUTER_REASONING_EXCLUDE);

  if (maxTokens != null) {
    return {
      max_tokens: maxTokens,
      ...(exclude != null ? { exclude } : preset && "exclude" in preset ? { exclude: preset.exclude } : {}),
    };
  }

  if (effort != null) {
    if (effort === "none") return undefined;
    return {
      effort,
      ...(exclude != null ? { exclude } : preset && "exclude" in preset ? { exclude: preset.exclude } : {}),
    };
  }

  if (exclude != null && preset) {
    return { ...preset, exclude };
  }

  return preset;
}

export function getOpenRouterReasoning(
  context: OpenRouterReasoningContext = "default",
): OpenRouterReasoningConfig | undefined {
  const preset = REASONING_PRESETS[context] ?? REASONING_PRESETS.default;
  const resolved = applyEnvOverrides(preset);

  if (!resolved) return undefined;
  if ("effort" in resolved && resolved.effort === "none") return undefined;

  return resolved;
}
