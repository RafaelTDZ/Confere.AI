import type {
  AICapability,
  AIProvider,
  DocumentAI,
} from "@confere/application";
import { AIGateway } from "./gateway.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { createModelResolver, type ModelAssignment } from "./registry.js";
import { GeminiDocumentIntelligence } from "./document-intelligence.js";

export interface CreateDocumentAIOptions {
  /** Overrides por tenant (tenant_settings.ai_overrides). */
  modelOverrides?: Partial<Record<AICapability, ModelAssignment>>;
  gatewayOptions?: { maxRetries?: number; baseBackoffMs?: number };
}

/**
 * Monta o DocumentAI a partir das envs do processo.
 * Registra automaticamente os adapters cujas chaves existem.
 */
export function createDocumentAI(
  options: CreateDocumentAIOptions = {},
): DocumentAI {
  const providers: Record<string, AIProvider> = {};

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) providers.gemini = new GeminiAdapter({ apiKey: geminiKey });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) providers.openai = new OpenAIAdapter({ apiKey: openaiKey });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey)
    providers.anthropic = new AnthropicAdapter({ apiKey: anthropicKey });

  const gateway = new AIGateway({
    providers,
    resolver: createModelResolver(options.modelOverrides),
    maxRetries: options.gatewayOptions?.maxRetries,
    baseBackoffMs: options.gatewayOptions?.baseBackoffMs,
  });

  return new GeminiDocumentIntelligence(gateway);
}
