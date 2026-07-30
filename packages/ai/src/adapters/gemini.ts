import {
  GoogleGenerativeAI,
  type GenerationConfig,
  type Part,
  type Schema,
} from "@google/generative-ai";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AIExtractInput,
  AIProvider,
  AIResult,
} from "@confere/application";

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export interface GeminiAdapterOptions {
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Adapter Google Gemini com structured output (responseSchema).
 * Converte Zod -> JSON Schema (dialeto OpenAPI 3, compativel com a API).
 */
export class GeminiAdapter implements AIProvider {
  readonly providerName = "gemini";
  private readonly client: GoogleGenerativeAI;
  private readonly timeoutMs: number;

  constructor(options: GeminiAdapterOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey);
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async extractStructured<T>(
    input: AIExtractInput,
    schema: ZodType<T>,
    model: string,
  ): Promise<AIResult<T>> {
    const startedAt = Date.now();
    const generationConfig: GenerationConfig = {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(schema),
      temperature: 0.1,
    };

    const generativeModel = this.client.getGenerativeModel({
      model,
      generationConfig,
    });

    const parts: Part[] = [{ text: input.prompt }];
    for (const file of input.files ?? []) {
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: toBase64(file.data),
        },
      });
    }
    if (input.context !== undefined) {
      parts.push({
        text: `CONTEXTO ESTRUTURADO:\n${JSON.stringify(input.context, null, 2)}`,
      });
    }

    let response;
    try {
      const result = await generativeModel.generateContent(
        { contents: [{ role: "user", parts }] },
        { timeout: this.timeoutMs },
      );
      response = result.response;
    } catch (error) {
      throw toProviderError(error, this.providerName);
    }

    const text = response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AIProviderError(
        `Resposta do modelo nao e JSON valido: ${text.slice(0, 200)}`,
        this.providerName,
        false,
      );
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new AIProviderError(
        `Resposta fora do schema esperado: ${validated.error.message}`,
        this.providerName,
        true,
      );
    }

    const usage = response.usageMetadata;
    return {
      data: validated.data,
      model,
      usage: {
        tokensIn: usage?.promptTokenCount ?? 0,
        tokensOut: usage?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}

function toGeminiSchema<T>(schema: ZodType<T>): Schema {
  const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" }) as Record<
    string,
    unknown
  >;
  const { $schema: _ignored, ...rest } = jsonSchema;
  return rest as unknown as Schema;
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function toProviderError(error: unknown, provider: string): AIProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const retryable =
    /429|500|502|503|504|timeout|deadline|unavailable|rate/i.test(message);
  return new AIProviderError(
    `Falha no provedor ${provider}: ${message}`,
    provider,
    retryable,
  );
}
