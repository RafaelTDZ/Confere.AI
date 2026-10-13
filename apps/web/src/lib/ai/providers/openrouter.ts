import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getOpenRouterApiKey } from "@/lib/ai/config";

/**
 * Client OpenRouter (servidor). Usa a chave OPENROUTER_API_KEY.
 * Não importe este módulo em Client Components.
 */
export function createOpenRouterClient() {
  return createOpenRouter({
    apiKey: getOpenRouterApiKey(),
  });
}

export {
  getOpenRouterApiKey,
  AiConfigError,
  OpenRouterConfigError,
} from "@/lib/ai/config";
export {
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterModel,
  getOpenRouterReasoning,
  type OpenRouterReasoningConfig,
  type OpenRouterReasoningContext,
  type OpenRouterReasoningEffort,
} from "@/lib/ai/providers/openrouter-model";
