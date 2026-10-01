import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getOpenRouterApiKey } from "@/lib/ai/config";
import {
  getOpenRouterModel,
  getOpenRouterReasoning,
} from "@/lib/ai/model-config";

/**
 * Client OpenRouter (servidor). Usa a chave OPENROUTER_API_KEY.
 * Não importe este módulo em Client Components.
 */
export function createOpenRouterClient() {
  return createOpenRouter({
    apiKey: getOpenRouterApiKey(),
  });
}

/** Modelo configurado via OPENROUTER_MODEL (default: ~openai/gpt-luna-latest). */
export function getDefaultLanguageModel() {
  const openrouter = createOpenRouterClient();
  const reasoning = getOpenRouterReasoning("smoke");
  return openrouter(
    getOpenRouterModel(),
    reasoning ? { reasoning } : undefined,
  );
}

export { getOpenRouterApiKey, OpenRouterConfigError } from "@/lib/ai/config";
export {
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterModel,
  getOpenRouterReasoning,
  type OpenRouterReasoningConfig,
  type OpenRouterReasoningContext,
  type OpenRouterReasoningEffort,
} from "@/lib/ai/model-config";
