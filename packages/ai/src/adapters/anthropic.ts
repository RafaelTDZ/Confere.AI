import type { ZodType } from "zod";
import type {
  AIExtractInput,
  AIProvider,
  AIResult,
} from "@confere/application";
import { AIProviderError } from "./gemini.js";

/**
 * Esqueleto do adapter Anthropic (Claude com tool use para structured output).
 * Implementar na versao 2.0 seguindo o mesmo contrato do GeminiAdapter:
 * - structured output via tools (input_schema) forcando tool_choice
 * - documentos PDF via content blocks do tipo document
 */
export class AnthropicAdapter implements AIProvider {
  readonly providerName = "anthropic";

  constructor(private readonly options: { apiKey: string }) {}

  async extractStructured<T>(
    _input: AIExtractInput,
    _schema: ZodType<T>,
    model: string,
  ): Promise<AIResult<T>> {
    throw new AIProviderError(
      `Adapter Anthropic ainda nao implementado (modelo: ${model}). ` +
        `Chave configurada: ${this.options.apiKey ? "sim" : "nao"}.`,
      this.providerName,
      false,
    );
  }
}
