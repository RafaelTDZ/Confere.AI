export interface EnqueueOptions {
  /** Chave de idempotencia: mesmo job com mesma chave nao duplica. */
  singletonKey?: string;
  /** Atraso antes da execucao, em segundos. */
  startAfterSeconds?: number;
  /** Tentativas em caso de falha. */
  retryLimit?: number;
  /** Prioridade (maior = antes). */
  priority?: number;
}

export interface QueuePublisher {
  enqueue<T>(jobName: string, data: T, options?: EnqueueOptions): Promise<string | null>;
}

export const JOB_NAMES = {
  processImport: "process-import",
  extractDocument: "extract-document",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export interface ProcessImportJobData {
  importId: string;
  tenantId: string;
}

export interface ExtractDocumentJobData {
  documentId: string;
  importId: string;
  tenantId: string;
}
