import type { AICapability, AIModelResolver } from "@confere/application";

export interface ModelAssignment {
  provider: string;
  model: string;
}

/**
 * Defaults por capability. Podem ser sobrescritos por tenant via
 * tenant_settings.ai_overrides ou globalmente por env:
 * AI_MODEL_OCR_EXTRACTION, AI_MODEL_DOCUMENT_COMPARISON, etc.
 */
export function createModelResolver(
  overrides: Partial<Record<AICapability, ModelAssignment>> = {},
): AIModelResolver {
  const defaultProvider = process.env.AI_DEFAULT_PROVIDER ?? "gemini";
  const defaultModel = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";

  const defaults: Record<AICapability, ModelAssignment> = {
    "ocr-extraction": { provider: defaultProvider, model: defaultModel },
    "document-comparison": { provider: defaultProvider, model: defaultModel },
    "product-matching": { provider: defaultProvider, model: defaultModel },
    "ncm-classification": { provider: defaultProvider, model: defaultModel },
    "description-generation": {
      provider: defaultProvider,
      model: defaultModel,
    },
    "validation-review": { provider: defaultProvider, model: defaultModel },
  };

  const envKey: Record<AICapability, string> = {
    "ocr-extraction": "AI_MODEL_OCR_EXTRACTION",
    "document-comparison": "AI_MODEL_DOCUMENT_COMPARISON",
    "product-matching": "AI_MODEL_PRODUCT_MATCHING",
    "ncm-classification": "AI_MODEL_NCM_CLASSIFICATION",
    "description-generation": "AI_MODEL_DESCRIPTION_GENERATION",
    "validation-review": "AI_MODEL_VALIDATION_REVIEW",
  };

  return {
    resolve(capability: AICapability): ModelAssignment {
      const fromTenant = overrides[capability];
      if (fromTenant) return fromTenant;

      const fromEnv = process.env[envKey[capability]];
      if (fromEnv) {
        const [provider, model] = fromEnv.split(":");
        if (provider && model) return { provider, model };
      }

      return defaults[capability];
    },
  };
}
