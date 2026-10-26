import type { AiProviderId } from "@/lib/ai/provider";

/**
 * Regra prática de compatibilidade entre provedor e modelo (sem `server-only`:
 * usada também no form de configurações).
 *
 * - `fireworks`: modelo do catálogo ou prefixo `accounts/fireworks/`
 *   (aceita routers/aliases novos sem deploy).
 * - `openrouter`: modelo do catálogo, slug `~provider/modelo` ou qualquer id
 *   com `/` — exceto ids do Fireworks (`accounts/fireworks/...`).
 */
export function isModelCompatibleWithProvider(
  provider: AiProviderId,
  model: string,
  presetIds: readonly string[],
): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  if (presetIds.includes(trimmed)) return true;
  if (provider === "fireworks") {
    return trimmed.startsWith("accounts/fireworks/");
  }
  if (trimmed.startsWith("accounts/fireworks/")) return false;
  return trimmed.startsWith("~") || trimmed.includes("/");
}
