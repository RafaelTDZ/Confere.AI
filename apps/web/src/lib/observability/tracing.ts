import "server-only";

import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

const tracer = trace.getTracer("confere-web");
const meter = metrics.getMeter("confere-web");

const aiCallDuration = meter.createHistogram("ai.call.duration", {
  description: "Duração das chamadas de IA por capability",
  unit: "ms",
});
const aiTokens = meter.createCounter("ai.call.tokens", {
  description: "Tokens de entrada e saída por capability",
  unit: "1",
});
const aiCost = meter.createCounter("ai.call.cost", {
  description: "Custo estimado em USD por capability",
  unit: "USD",
});

export type AiCallMetrics = {
  capability: string;
  model: string;
  status: "success" | "error";
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd?: number | null;
};

/** Métricas por chamada de IA (além do registro durável em `ai_logs`). */
export function recordAiCall(params: AiCallMetrics): void {
  const labels: Attributes = {
    "ai.capability": params.capability,
    "ai.model": params.model,
    "ai.status": params.status,
  };

  aiCallDuration.record(params.latencyMs, labels);
  aiTokens.add(params.tokensIn + params.tokensOut, labels);
  if (typeof params.costUsd === "number") {
    aiCost.add(params.costUsd, labels);
  }
}

/**
 * Executa `fn` dentro de um span com atributos e erro registrado.
 * Sem SDK configurado (testes/local), o OTel devolve um no-op e nada muda.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
