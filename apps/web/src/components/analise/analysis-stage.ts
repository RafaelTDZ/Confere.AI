/** Status do job de análise, como a API devolve em `/api/ai/jobs/[jobId]`. */
export type AnalysisJobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * Rótulo do estágio enquanto o job roda. A análise tem fases com durações bem
 * diferentes (parse do PDF, extração com IA, persistência/rastreio), então o
 * texto avança com o tempo em vez de repetir "Analisando" por 30-60s.
 */
export function analysisStageLabel(
  status: AnalysisJobStatus,
  elapsedMs: number,
): string | null {
  if (status === "queued") return "Na fila...";
  if (status === "succeeded" || status === "failed") return null;
  if (elapsedMs < 8_000) return "Lendo o documento...";
  if (elapsedMs < 25_000) return "Extraindo os dados com IA...";
  return "Finalizando a análise...";
}
