import { createFireworksClient } from "@/lib/ai/providers/fireworks";
import { getFireworksModel } from "@/lib/ai/providers/fireworks-config";
import { createOpenRouterClient } from "@/lib/ai/providers/openrouter";
import {
  getOpenRouterModel,
  getOpenRouterReasoning,
} from "@/lib/ai/providers/openrouter-model";

/**
 * Provedor de IA ativo, configurado via AI_PROVIDER.
 * Valores: "openrouter" (default) | "fireworks".
 */
export type AiProviderId = "openrouter" | "fireworks";

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
  const overrides: AiOverrides = {};
  if (record.provider === "openrouter" || record.provider === "fireworks") {
    overrides.provider = record.provider;
  }
  const model = sanitizeModel(record.model);
  if (model) overrides.model = model;
  return overrides;
}

export function getAiProvider(overrides?: AiOverrides): AiProviderId {
  if (overrides?.provider) return overrides.provider;
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  return raw === "fireworks" ? "fireworks" : "openrouter";
}

function getEnvModelId(provider: AiProviderId): string {
  return provider === "fireworks" ? getFireworksModel() : getOpenRouterModel();
}

/** ID do modelo efetivo (override do tenant ou FIREWORKS_MODEL/OPENROUTER_MODEL). */
export function getAiModelId(overrides?: AiOverrides): string {
  const provider = getAiProvider(overrides);
  return overrides?.model?.trim() || getEnvModelId(provider);
}

/** Modelo de texto do provider efetivo (usado no smoke /api/ai/health). */
export function getDefaultLanguageModel(overrides?: AiOverrides) {
  const provider = getAiProvider(overrides);
  const modelId = getAiModelId(overrides);
  if (provider === "fireworks") {
    // GLM-5.3-Flash já tem thinking nativo; sem options de reasoning/plugins.
    return createFireworksClient()(modelId);
  }
  const openrouter = createOpenRouterClient();
  const reasoning = getOpenRouterReasoning("smoke");
  return openrouter(modelId, reasoning ? { reasoning } : undefined);
}
