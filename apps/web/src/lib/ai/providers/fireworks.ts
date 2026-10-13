import { createFireworks } from "@ai-sdk/fireworks";
import { getFireworksApiKey } from "@/lib/ai/providers/fireworks-config";

/**
 * Client Fireworks (servidor). Usa a chave FIREWORKS_API_KEY.
 * Não importe este módulo em Client Components.
 */
export function createFireworksClient() {
  return createFireworks({
    apiKey: getFireworksApiKey(),
  });
}

export {
  getFireworksApiKey,
  FireworksConfigError,
} from "@/lib/ai/providers/fireworks-config";
export {
  DEFAULT_FIREWORKS_MODEL,
  getFireworksModel,
} from "@/lib/ai/providers/fireworks-config";
