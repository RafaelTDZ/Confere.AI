import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getOpenRouterApiKey, getOpenRouterModel } from "@/lib/ai/config";

/**
 * Client OpenRouter (servidor). Usa a chave OPENROUTER_API_KEY.
 * Não importe este módulo em Client Components.
 */
export function createOpenRouterClient() {
  return createOpenRouter({
    apiKey: getOpenRouterApiKey(),
  });
}

/** Modelo configurado via OPENROUTER_MODEL (default: openai/gpt-5.6-luna). */
export function getDefaultLanguageModel() {
  const openrouter = createOpenRouterClient();
  return openrouter(getOpenRouterModel());
}

export { getOpenRouterApiKey, getOpenRouterModel, OpenRouterConfigError } from "@/lib/ai/config";
