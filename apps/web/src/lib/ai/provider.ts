import "server-only";

import { createOpenRouterClient } from "@/lib/ai/providers/openrouter";
import {
  getOpenRouterModel,
  getOpenRouterReasoning,
} from "@/lib/ai/providers/openrouter-model";

/** Provedor único de IA: OpenRouter. */
export type AiProviderId = "openrouter";

/**
 * Override por tenant (persistido em tenant_settings.ai_overrides).
 * Ausente/vazio = padrão do servidor (env).
 */
export type AiOverrides = {
  provider?: AiProviderId;
  model?: string;
};

function sanitizeModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return undefined;
  return trimmed;
}

/** Normaliza overrides vindos do banco/API (ignora valores inválidos). */
export function normalizeOverrides(raw: unknown): AiOverrides {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  // Legado: providers "fireworks"/"opencode" foram removidos — descarta a
  // linha inteira (inclui o modelo, incompatível com o OpenRouter) até a
  // migration zerar essas linhas no banco.
  if (record.provider !== undefined && record.provider !== "openrouter") {
    return {};
  }
  const overrides: AiOverrides = {};
  if (record.provider === "openrouter") {
    overrides.provider = record.provider;
  }
  const model = sanitizeModel(record.model);
  if (model) overrides.model = model;
  return overrides;
}

export function getAiProvider(overrides?: AiOverrides): AiProviderId {
  // Provedor único: ignora override/env, sempre OpenRouter.
  // (parâmetro mantido para compatibilidade com os call sites)
  void overrides;
  return "openrouter";
}

/** ID do modelo efetivo (override do tenant ou OPENROUTER_MODEL). */
export function getAiModelId(overrides?: AiOverrides): string {
  return overrides?.model?.trim() || getOpenRouterModel();
}

/** Modelo de texto do provider efetivo (usado no smoke /api/ai/health). */
export function getDefaultLanguageModel(overrides?: AiOverrides) {
  const modelId = getAiModelId(overrides);
  const openrouter = createOpenRouterClient();
  const reasoning = getOpenRouterReasoning("smoke");
  return openrouter(modelId, reasoning ? { reasoning } : undefined);
}
