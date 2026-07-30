import type { ZodType } from "zod";
import type {
  AIExtractInput,
  AIModelResolver,
  AIProvider,
  AIResult,
} from "@confere/application";
import { AIProviderError } from "./adapters/gemini.js";

export interface AIGatewayOptions {
  providers: Record<string, AIProvider>;
  resolver: AIModelResolver;
  /** Tentativas maximas por chamada (default 3). */
  maxRetries?: number;
  /** Backoff base em ms (default 1000; exponencial com jitter). */
  baseBackoffMs?: number;
}

/**
 * Ponto unico de entrada para chamadas de IA:
 * resolve provider/model por capability, aplica retry com backoff
 * exponencial e padroniza erros.
 */
export class AIGateway {
  private readonly providers: Record<string, AIProvider>;
  private readonly resolver: AIModelResolver;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;

  constructor(options: AIGatewayOptions) {
    this.providers = options.providers;
    this.resolver = options.resolver;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
  }

  async extractStructured<T>(
    input: AIExtractInput,
    schema: ZodType<T>,
  ): Promise<AIResult<T>> {
    const assignment = this.resolver.resolve(input.capability);
    const provider = this.providers[assignment.provider];
    if (!provider) {
      throw new AIProviderError(
        `Provider "${assignment.provider}" nao registrado no gateway. ` +
          `Disponiveis: ${Object.keys(this.providers).join(", ")}`,
        assignment.provider,
        false,
      );
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await provider.extractStructured(input, schema, assignment.model);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof AIProviderError ? error.retryable : true;
        if (!retryable || attempt === this.maxRetries) break;
        await sleep(this.backoffWithJitter(attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }

  private backoffWithJitter(attempt: number): number {
    const base = this.baseBackoffMs * 2 ** (attempt - 1);
    return base + Math.floor(Math.random() * base * 0.5);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
