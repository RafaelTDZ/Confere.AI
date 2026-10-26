import "server-only";

import { createFireworksClient } from "@/lib/ai/providers/fireworks";
import { getFireworksModel } from "@/lib/ai/providers/fireworks-config";
import { createOpenRouterClient } from "@/lib/ai/providers/openrouter";
import {
  getOpenRouterModel,
  getOpenRouterReasoning,
} from "@/lib/ai/providers/openrouter-model";

/** Provedores de IA suportados. */
export type AiProviderId = "fireworks" | "openrouter";

/** Provedor padrão quando não há override nem AI_PROVIDER. */
const DEFAULT_AI_PROVIDER: AiProviderId = "fireworks";

/**
 * Override por tenant (persistido em tenant_settings.ai_overrides).
 * Ausente/vazio = padrão do servidor (env).
 */
export type AiOverrides = {
  provider?: AiProviderId;
  model?: string;
};

function isAiProviderId(value: unknown): value is AiProviderId {
  return value === "fireworks" || value === "openrouter";
}

function sanitizeModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return undefined;
  return trimmed;
}

/**
 * Normaliza overrides vindos do banco/API (ignora valores inválidos).
 * Provider desconhecido (legado `opencode`, typo) descarta a linha inteira:
 * o modelo pode ser incompatível com o provider efetivo.
 */
export function normalizeOverrides(raw: unknown): AiOverrides {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  if (record.provider !== undefined && !isAiProviderId(record.provider)) {
    return {};
  }
  const overrides: AiOverrides = {};
  if (isAiProviderId(record.provider)) {
    overrides.provider = record.provider;
  }
  const model = sanitizeModel(record.model);
  if (model) overrides.model = model;
  return overrides;
}

/**
 * Provedor efetivo: override válido → AI_PROVIDER (case-insensitive) →
 * padrão Fireworks. Valores desconhecidos em AI_PROVIDER são ignorados.
 */
export function getAiProvider(overrides?: AiOverrides): AiProviderId {
  if (isAiProviderId(overrides?.provider)) return overrides.provider;
  const envProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (isAiProviderId(envProvider)) return envProvider;
  return DEFAULT_AI_PROVIDER;
}

/**
 * ID do modelo efetivo: override do tenant → FIREWORKS_MODEL/OPENROUTER_MODEL
 * conforme o provider efetivo → modelo padrão do provider.
 */
export function getAiModelId(overrides?: AiOverrides): string {
  const overrideModel = overrides?.model?.trim();
  if (overrideModel) return overrideModel;
  if (getAiProvider(overrides) === "fireworks") return getFireworksModel();
  return getOpenRouterModel();
}

/** Modelo de texto do provider efetivo (usado no smoke /api/ai/health). */
export function getDefaultLanguageModel(overrides?: AiOverrides) {
  const modelId = getAiModelId(overrides);

  if (getAiProvider(overrides) === "fireworks") {
    const fireworks = createFireworksClient();
    return fireworks(modelId);
  }

  const openrouter = createOpenRouterClient();
  const reasoning = getOpenRouterReasoning("smoke");
  return openrouter(modelId, reasoning ? { reasoning } : undefined);
}
