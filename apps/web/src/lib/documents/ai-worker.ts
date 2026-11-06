import "server-only";

import { PdfConversionError } from "@/lib/ai/pdf-pages";
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
import {
  createLogger,
  createTimer,
  runWithLogContext,
} from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracing";
import { runWithAdminReads } from "@/lib/supabase/read-client";
import { processQueuedTrackingJobs } from "@/lib/tracking/service";

const log = createLogger("ai-worker");

/** Executa um job já reservado: baixa o arquivo, roda o pipeline e fecha o estado. */
async function runClaimedJob(job: AiJobRow): Promise<void> {
  const timer = createTimer();
  const jobLog = log.child({
    jobId: job.id,
    tenantId: job.tenant_id,
    importId: job.import_id ?? undefined,
    attempt: job.attempts,
    worker: "ai",
  });

  jobLog.info("job_started", { storagePath: job.storage_path });

  let result;
  let file: File;
  try {
    file = await downloadAiJobFile(job);
    result = await withSpan(
      "ai.job",
      {
        "job.id": job.id,
        "job.attempt": job.attempts,
        "tenant.id": job.tenant_id,
      },
      () =>
        runWithAdminReads(() =>
          runWithLogContext({ jobId: job.id, tenantId: job.tenant_id }, () =>
            runAnalyzePipeline({
              tenantId: job.tenant_id,
              userId: job.user_id ?? "",
              file,
              importId: job.import_id ?? undefined,
            }),
          ),
        ),
    );
  } catch (error) {
    // `PdfConversionError` já traz a mensagem acionável de PDF → imagens; ela
    // vai direto para `ai_jobs.error_message`, sem prefixo genérico.
    const message =
      error instanceof Error ? error.message : "Falha ao analisar documento";
    jobLog.error(
      error instanceof PdfConversionError
        ? "pdf_conversion_failed"
        : "job_failed",
      {
        error,
        message,
        elapsedMs: timer.elapsedMs(),
      },
    );

    try {
      await markAiJobFailed(job.id, message);
    } catch (markError) {
      jobLog.error("job_fail_persist_failed", {
        error: markError,
        originalMessage: message,
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
    jobLog.error("job_finish_failed", { error });
    return;
  }

  jobLog.info("job_succeeded", {
    importId: result.importId,
    types: result.types,
    deduped: result.deduped,
    model: result.model,
    latencyMs: result.latencyMs,
    elapsedMs: timer.elapsedMs(),
    fileBytes: file.size,
  });

  // A primeira consulta ao armador é acessória e pode levar 5-35s (Firecrawl da
  // Maersk): roda depois do job fechado, para o cliente receber o resultado da
  // análise sem esperar o rastreio. O `after()` da request mantém a função viva
  // até este await terminar; sem isso o cron diário seria o único resgate.
  if (result.trackingPending) {
    try {
      const tracking = await processQueuedTrackingJobs({
        limit: 1,
        worker: "analyze",
        importId: result.importId,
      });
      jobLog.info("tracking_first_query_finished", {
        importId: result.importId,
        processed: tracking.processed,
        failed: tracking.failed,
        elapsedMs: timer.elapsedMs(),
      });
    } catch (error) {
      // Sem chave/orçamento o próprio processamento marca `blocked`.
      jobLog.error("tracking_first_query_failed", {
        importId: result.importId,
        error,
      });
    }
  }
}

/**
 * Processa um job específico. Retorna sem fazer nada quando outro worker já
 * reservou o job (`claim` devolve `null`), o que torna a chamada idempotente.
 */
export async function processAiJobById(jobId: string): Promise<void> {
  const job = await claimAiJob(jobId);
  if (!job) {
    log.info("claim_skipped", { jobId, reason: "already_claimed" });
    return;
  }
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
