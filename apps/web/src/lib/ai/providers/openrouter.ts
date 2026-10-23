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

export { AiConfigError } from "@/lib/ai/config";
