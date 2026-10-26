import "server-only";

import { createFireworks } from "@ai-sdk/fireworks";
import { getFireworksApiKey } from "@/lib/ai/providers/fireworks-config";

/**
 * Client Fireworks (servidor). Usa a chave FIREWORKS_API_KEY.
 * PDFs não são aceitos pela API: o servidor converte as páginas em imagens.
 * Não importe este módulo em Client Components.
 */
export function createFireworksClient() {
  return createFireworks({
    apiKey: getFireworksApiKey(),
  });
}
