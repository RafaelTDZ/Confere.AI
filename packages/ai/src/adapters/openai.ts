import type { ZodType } from "zod";
import type {
  AIExtractInput,
  AIProvider,
  AIResult,
} from "@confere/application";
import { AIProviderError } from "./gemini.js";

/**
 * Esqueleto do adapter OpenAI (gpt-4o / responses API com json_schema).
 * Implementar na versao 2.0 seguindo o mesmo contrato do GeminiAdapter:
 * - structured output via response_format json_schema (strict: true)
 * - arquivos via upload prévio (files API) ou base64 (visao)
 */
export class OpenAIAdapter implements AIProvider {
  readonly providerName = "openai";

  constructor(private readonly options: { apiKey: string }) {}

  async extractStructured<T>(
    _input: AIExtractInput,
    _schema: ZodType<T>,
    model: string,
  ): Promise<AIResult<T>> {
    throw new AIProviderError(
      `Adapter OpenAI ainda nao implementado (modelo: ${model}). ` +
        `Configure AI_DEFAULT_PROVIDER=gemini ou implemente OpenAIAdapter.extractStructured. ` +
        `Chave configurada: ${this.options.apiKey ? "sim" : "nao"}.`,
      this.providerName,
      false,
    );
  }
}
