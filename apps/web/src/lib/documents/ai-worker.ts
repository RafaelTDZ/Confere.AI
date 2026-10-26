import "server-only";

import { runAnalyzePipeline } from "@/lib/documents/analyze-pipeline";
import {
  claimAiJob,
  claimNextAiJob,
  downloadAiJobFile,
  markAiJobFailed,
  markAiJobSucceeded,
  removeAiJobFile,
  type AiJobRow,
} from "@/lib/documents/ai-jobs";

/** Executa um job já reservado: baixa o arquivo, roda o pipeline e fecha o estado. */
async function runClaimedJob(job: AiJobRow): Promise<void> {
  let result;
  try {
    const file = await downloadAiJobFile(job);
    result = await runAnalyzePipeline({
      tenantId: job.tenant_id,
      userId: job.user_id ?? "",
      file,
      importId: job.import_id ?? undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao analisar documento";
    console.error("[ai-worker] job falhou", { jobId: job.id, message });

    try {
      await markAiJobFailed(job.id, message);
    } catch (markError) {
      console.error("[ai-worker] falha ao registrar erro do job", {
        jobId: job.id,
        markError,
      });
    }
    return;
  }

  // A análise já foi persistida: falha ao fechar o job não a marca como failed.
  try {
    await markAiJobSucceeded(job.id, {
      importId: result.importId,
      types: result.types,
      deduped: result.deduped,
    });
    await removeAiJobFile(job.storage_path);
  } catch (error) {
    console.error("[ai-worker] falha ao concluir job", {
      jobId: job.id,
      error,
    });
  }
}

/**
 * Processa um job específico. Retorna sem fazer nada quando outro worker já
 * reservou o job (`claim` devolve `null`), o que torna a chamada idempotente.
 */
export async function processAiJobById(jobId: string): Promise<void> {
  const job = await claimAiJob(jobId);
  if (!job) return;
  await runClaimedJob(job);
}

/**
 * Processa o próximo job da fila (ou um `running` travado). Usado pelo
 * endpoint de retry/cron; devolve `false` quando a fila está vazia.
 */
export async function processNextAiJob(options?: {
  staleSeconds?: number;
}): Promise<boolean> {
  const job = await claimNextAiJob(options);
  if (!job) return false;
  await runClaimedJob(job);
  return true;
}
