import type { ZodType } from "zod";

export const AI_CAPABILITIES = [
  "ocr-extraction",
  "document-comparison",
  "product-matching",
  "ncm-classification",
  "description-generation",
  "validation-review",
] as const;

export type AICapability = (typeof AI_CAPABILITIES)[number];

export interface AIFileRef {
  /** Bytes do arquivo ou URL acessivel pelo provedor. */
  data: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface AIUsage {
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface AIResult<T> {
  data: T;
  model: string;
  usage: AIUsage;
}

export interface AIExtractInput {
  capability: AICapability;
  /** Prompt principal (system + task). */
  prompt: string;
  /** Arquivos de entrada (PDF/imagem) quando aplicavel. */
  files?: AIFileRef[];
  /** Contexto estruturado adicional (ex: extracoes anteriores). */
  context?: unknown;
}

/**
 * Port unico para provedores de IA. Implementacoes devem garantir
 * structured output validado pelo schema Zod informado.
 */
export interface AIProvider {
  readonly providerName: string;
  extractStructured<T>(
    input: AIExtractInput,
    schema: ZodType<T>,
    model: string,
  ): Promise<AIResult<T>>;
}

/** Resolve provider/model por capability (gateway injeta overrides por tenant). */
export interface AIModelResolver {
  resolve(capability: AICapability): { provider: string; model: string };
}
