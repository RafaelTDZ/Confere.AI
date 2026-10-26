import "server-only";

import { randomUUID } from "node:crypto";
import type { DocumentType } from "@/lib/ai/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getReadClient } from "@/lib/supabase/read-client";
import { uploadImportFile } from "@/lib/documents/storage";

const JOBS_BUCKET = "import-documents";
const MAX_ERROR_LENGTH = 500;

type AiJobStatus = "queued" | "running" | "succeeded" | "failed";

export type AiJobResult = {
  importId: string;
  types: DocumentType[];
  deduped: boolean;
};

export type AiJobRow = {
  id: string;
  tenant_id: string;
  import_id: string | null;
  user_id: string | null;
  status: AiJobStatus;
  storage_path: string;
  file_name: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  attempts: number;
  error_message: string | null;
  result: AiJobResult | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const AI_JOB_SELECT =
  "id, tenant_id, import_id, user_id, status, storage_path, file_name, media_type, size_bytes, sha256, attempts, error_message, result, created_at, started_at, finished_at";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180);
}

/** Arquivo bruto do upload fica isolado por job; é removido quando conclui. */
function buildJobStoragePath(
  tenantId: string,
  jobId: string,
  filename: string,
): string {
  return `${tenantId}/_jobs/${jobId}/${sanitizeFilename(filename)}`;
}

/**
 * Guarda o arquivo no Storage e cria o job na fila.
 * O upload acontece antes do insert para o worker nunca pegar um job sem bytes.
 */
export async function createAiJob(params: {
  tenantId: string;
  userId: string;
  importId?: string;
  file: {
    bytes: Uint8Array;
    filename: string;
    mediaType: string;
    digest: string;
  };
}): Promise<AiJobRow> {
  const jobId = randomUUID();
  const storagePath = buildJobStoragePath(
    params.tenantId,
    jobId,
    params.file.filename,
  );

  await uploadImportFile({
    storagePath,
    bytes: params.file.bytes,
    mediaType: params.file.mediaType,
  });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ai_jobs")
    .insert({
      id: jobId,
      tenant_id: params.tenantId,
      import_id: params.importId ?? null,
      user_id: params.userId,
      status: "queued",
      storage_path: storagePath,
      file_name: params.file.filename,
      media_type: params.file.mediaType,
      size_bytes: params.file.bytes.byteLength,
      sha256: params.file.digest,
    })
    .select(AI_JOB_SELECT)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Falha ao criar job de análise");
  }

  return data as AiJobRow;
}

/** Lê o job com o client do usuário (RLS por tenant). */
export async function getAiJobForTenant(
  tenantId: string,
  jobId: string,
): Promise<AiJobRow | null> {
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("ai_jobs")
    .select(AI_JOB_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao consultar job de análise");
  }

  return (data as AiJobRow | null) ?? null;
}

/** Claim atômico de um job específico; devolve `null` se outro worker pegou. */
export async function claimAiJob(jobId: string): Promise<AiJobRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_ai_job", {
    p_job_id: jobId,
  });

  if (error) {
    throw new Error(error.message || "Falha ao reservar job de análise");
  }

  return (data as AiJobRow | null) ?? null;
}

/** Claim do próximo job da fila (inclui jobs travados há mais tempo). */
export async function claimNextAiJob(options?: {
  staleSeconds?: number;
  maxAttempts?: number;
}): Promise<AiJobRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_next_ai_job", {
    p_stale_seconds: options?.staleSeconds ?? 900,
    p_max_attempts: options?.maxAttempts ?? 3,
  });

  if (error) {
    throw new Error(error.message || "Falha ao reservar próximo job");
  }

  return (data as AiJobRow | null) ?? null;
}

export async function markAiJobSucceeded(
  jobId: string,
  result: AiJobResult,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ai_jobs")
    .update({
      status: "succeeded",
      import_id: result.importId,
      result,
      finished_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message || "Falha ao concluir job de análise");
  }
}

export async function markAiJobFailed(
  jobId: string,
  message: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ai_jobs")
    .update({
      status: "failed",
      error_message: message.slice(0, MAX_ERROR_LENGTH),
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message || "Falha ao registrar erro do job");
  }
}

/** Baixa o arquivo bruto do job e monta o `File` esperado pelo pipeline. */
export async function downloadAiJobFile(job: AiJobRow): Promise<File> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(JOBS_BUCKET)
    .download(job.storage_path);

  if (error || !data) {
    throw new Error(
      error?.message || "Falha ao baixar arquivo do job de análise",
    );
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  return new File([bytes], job.file_name, { type: job.media_type });
}

/** Remove o arquivo bruto; falha só registra log (job já concluiu). */
export async function removeAiJobFile(storagePath: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(JOBS_BUCKET).remove([storagePath]);
  if (error) {
    console.error("[ai-jobs] falha ao remover arquivo do job", error);
  }
}
