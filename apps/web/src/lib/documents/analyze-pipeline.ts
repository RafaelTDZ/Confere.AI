import "server-only";

import { classifyDocument } from "@/lib/ai/tasks/classify";
import { extractBl } from "@/lib/ai/tasks/extract-bl";
import { extractInvoice } from "@/lib/ai/tasks/extract-invoice";
import { extractPackingList } from "@/lib/ai/tasks/extract-packing-list";
import {
  prepareDocument,
  type AnalyzeFileInput,
  type PreparedDocument,
} from "@/lib/ai/document-content";
import {
  assertAllowedFile,
  normalizeMediaType,
  sha256Hex,
} from "@/lib/ai/file-utils";
import { getAiModelId, type AiOverrides } from "@/lib/ai";
import {
  detectDocumentTypes,
  preparedDocumentText,
} from "@/lib/ai/document-type-heuristic";
import { getAiOverrides } from "@/lib/settings/ai-settings";
import type {
  BlExtraction,
  DocumentClassification,
  DocumentType,
  InvoiceExtraction,
  PackingListExtraction,
} from "@/lib/ai/schemas";
import type { AiTaskUsage } from "@/lib/ai/usage";
import { attachAiLogsToImport, persistAiLog } from "@/lib/documents/ai-logs";
import {
  findDocumentsBySha256,
  findTenantDocumentsBySha256,
  insertDocuments,
  updateDocumentStatus,
  type TenantDocumentBySha,
} from "@/lib/documents/documents";
import {
  findOrCreateImport,
  fillImportKeysIfEmpty,
  fillImportReferenceIfEmpty,
  clearAutoReferenceIfNeeded,
  getImportDetail,
  syncImportEta,
  updateImportConsignee,
  updateImportConsigneeDivergences,
  updateImportStatus,
} from "@/lib/documents/imports";
import {
  compareConsignee,
  snapshotFromExtractedParty,
  type ConsigneeDefault,
} from "@/lib/documents/consignee-check";
import { getDefaultConsignee } from "@/lib/documents/consignee-settings";
import {
  IMPORT_DOCUMENT_TYPES,
  normalizeImportKey,
} from "@/lib/documents/imports-shared";
import { extractImportReference } from "@/lib/documents/import-reference";
import {
  findLatestExtractionsByDocumentIds,
  persistExtractionResult,
  type LatestExtraction,
} from "@/lib/documents/extractions";
import { enqueueTrackingForImport } from "@/lib/tracking/service";
import {
  combinePendingParties,
  pendingPartiesFromBl,
  pendingPartiesFromInvoice,
  resolveBlParties,
  resolveInvoiceParties,
  type PendingParty,
} from "@/lib/documents/parties";
import {
  buildUniqueStoragePath,
  copyImportFile,
  uploadImportFile,
} from "@/lib/documents/storage";
import { recordAiCall, withSpan } from "@/lib/observability/tracing";
import {
  createLogger,
  createTimer,
  runWithLogContext,
} from "@/lib/observability/logger";

const log = createLogger("analyze-pipeline");

export type AnalyzePipelineResult = {
  importId: string;
  types: DocumentType[];
  documents: Array<{ id: string; docType: DocumentType }>;
  invoice: InvoiceExtraction | null;
  extractionResultId: string | null;
  pendingParties: PendingParty[];
  model: string;
  latencyMs: number;
  deduped: boolean;
  /**
   * BL enfileirado para rastreio. A primeira consulta ao armador não roda mais
   * dentro da análise: ela pode levar 5-35s (Firecrawl da Maersk) e segurava o
   * `succeeded` do job, então quem roda é o worker, depois de fechar o job.
   */
  trackingPending: boolean;
};

type AnalyzePipelineParams = {
  tenantId: string;
  userId: string;
  file: File;
  startedAt?: number;
  importId?: string;
  /**
   * Caminho do PDF bruto no Storage (`_jobs/<jobId>/...`), que o worker acabou
   * de baixar. Quando presente, o arquivo definitivo é uma **cópia** no próprio
   * Storage em vez de um segundo upload dos mesmos bytes.
   */
  sourceStoragePath?: string;
};

/**
 * Grava o PDF no caminho definitivo da importação. Copiar do arquivo do job é
 * bem mais rápido que reenviar os bytes; se a cópia falhar, sobe normalmente.
 */
async function persistImportFile(params: {
  storagePath: string;
  bytes: Uint8Array;
  mediaType: string;
  sourceStoragePath?: string;
}): Promise<void> {
  if (params.sourceStoragePath) {
    try {
      await copyImportFile({
        fromPath: params.sourceStoragePath,
        toPath: params.storagePath,
      });
      return;
    } catch (error) {
      log.warn("storage_copy_failed", {
        from: params.sourceStoragePath,
        to: params.storagePath,
        error,
      });
    }
  }

  await uploadImportFile({
    storagePath: params.storagePath,
    bytes: params.bytes,
    mediaType: params.mediaType,
  });
}

type ReusableUpload = {
  latestImportId: string;
  docs: TenantDocumentBySha[];
  extractions: Map<string, LatestExtraction>;
};

async function findReusableUpload(
  tenantId: string,
  sha256: string,
): Promise<ReusableUpload | null> {
  const docs = await findTenantDocumentsBySha256({ tenantId, sha256 });
  if (docs.length === 0) return null;

  // Agrupa por storage_path (cada upload tem um path próprio). A ordem é
  // created_at desc, então o upload mais recente é testado primeiro; se ele
  // estiver incompleto, ainda podemos reaproveitar um upload anterior válido.
  const groups = new Map<string, TenantDocumentBySha[]>();
  for (const doc of docs) {
    const group = groups.get(doc.storagePath);
    if (group) {
      group.push(doc);
    } else {
      groups.set(doc.storagePath, [doc]);
    }
  }

  for (const group of groups.values()) {
    const latestDoc = group[0];
    if (!latestDoc) continue;
    if (group.some((d) => d.status !== "extracted")) continue;

    const extractions = await findLatestExtractionsByDocumentIds({
      tenantId,
      documentIds: group.map((d) => d.id),
    });
    if (group.some((d) => !extractions.has(d.id))) continue;

    return { latestImportId: latestDoc.importId, docs: group, extractions };
  }

  return null;
}

function extractionForType(
  docs: TenantDocumentBySha[],
  extractions: Map<string, LatestExtraction>,
  docType: DocumentType,
): LatestExtraction | null {
  const doc = docs.find((d) => d.docType === docType);
  if (!doc) return null;
  return extractions.get(doc.id) ?? null;
}

/** Persiste a extração dentro de um span (tenant/documento, sem PII). */
async function persistExtractionWithSpan(
  params: Parameters<typeof persistExtractionResult>[0],
): Promise<string> {
  return withSpan(
    "ai.persist_extraction",
    {
      "tenant.id": params.tenantId,
      "document.id": params.documentId,
    },
    () => persistExtractionResult(params),
  );
}

type PipelineTracker = { importId?: string };

function documentConsigneeFrom(
  invoice: InvoiceExtraction | null,
  bl: BlExtraction | null,
) {
  return snapshotFromExtractedParty(
    invoice?.importer ??
      bl?.consigneeDetails ??
      (bl?.consignee
        ? { name: bl.consignee, cnpj: null, address: null }
        : null),
  );
}

/**
 * Consignee padrão do tenant: se configurado, ele é sempre o consignee da
 * importação; o documento só alimenta a verificação de divergências. Sem
 * padrão, limpa a verificação (`null`) e mantém o consignee extraído.
 */
async function applyDefaultConsignee(params: {
  tenantId: string;
  importId: string;
  invoice: InvoiceExtraction | null;
  bl: BlExtraction | null;
}): Promise<ConsigneeDefault | null> {
  const defaultConsignee = await getDefaultConsignee(params.tenantId);
  const documentConsignee = documentConsigneeFrom(params.invoice, params.bl);
  const divergences = compareConsignee(documentConsignee, defaultConsignee);

  // As duas escritas são independentes: uma viagem ao banco em vez de duas.
  await Promise.all([
    defaultConsignee
      ? updateImportConsignee({
          tenantId: params.tenantId,
          importId: params.importId,
          partyId: defaultConsignee.id,
        })
      : Promise.resolve(),
    updateImportConsigneeDivergences({
      tenantId: params.tenantId,
      importId: params.importId,
      divergences: defaultConsignee ? divergences : null,
    }),
  ]);

  return defaultConsignee;
}

/** Remove o papel `consignee` dos pendentes (o padrão não é cadastrado à mão). */
function withoutConsigneeRoles(items: PendingParty[]): PendingParty[] {
  return items
    .map((item) => ({
      ...item,
      roles: item.roles.filter((role) => role !== "consignee"),
    }))
    .filter((item) => item.roles.length > 0);
}

async function buildReusableResult(
  params: AnalyzePipelineParams,
  reusable: ReusableUpload,
  file: {
    buffer: Uint8Array;
    digest: string;
    filename: string;
    mediaType: string;
  },
  started: number,
  tracker: PipelineTracker,
): Promise<AnalyzePipelineResult> {
  const { docs, extractions } = reusable;
  const types = IMPORT_DOCUMENT_TYPES.filter((type) =>
    docs.some((doc) => doc.docType === type),
  );
  const invoiceExtraction = extractionForType(docs, extractions, "invoice");
  const packingListExtraction = extractionForType(
    docs,
    extractions,
    "packing_list",
  );
  const blExtraction = extractionForType(docs, extractions, "bill_of_lading");
  const invoice = (invoiceExtraction?.payload as InvoiceExtraction) ?? null;
  const packingList =
    (packingListExtraction?.payload as PackingListExtraction) ?? null;
  const bl = (blExtraction?.payload as BlExtraction) ?? null;
  const model =
    invoiceExtraction?.model ??
    extractions.values().next().value?.model ??
    "cache";
  let extractionResultId = invoiceExtraction?.id ?? null;

  let importId: string;
  let documents: Array<{ id: string; docType: DocumentType }>;

  if (!params.importId) {
    importId = reusable.latestImportId;
    documents = docs.map(({ id, docType }) => ({ id, docType }));
  } else {
    await getImportDetail(params.tenantId, params.importId);
    importId = params.importId;

    if (reusable.latestImportId === params.importId) {
      documents = docs.map(({ id, docType }) => ({ id, docType }));
    } else {
      const storagePath = await buildUniqueStoragePath({
        tenantId: params.tenantId,
        importId,
        filename: file.filename,
        digest: file.digest,
      });
      await persistImportFile({
        storagePath,
        bytes: file.buffer,
        mediaType: file.mediaType,
        sourceStoragePath: params.sourceStoragePath,
      });

      const newDocs = await insertDocuments({
        tenantId: params.tenantId,
        importId,
        types,
        storagePath,
        sha256: file.digest,
        filename: file.filename,
        mediaType: file.mediaType,
        sizeBytes: file.buffer.byteLength,
      });

      for (const newDoc of newDocs) {
        const extraction = extractionForType(docs, extractions, newDoc.docType);
        if (!extraction) continue;

        const newExtractionId = await persistExtractionWithSpan({
          tenantId: params.tenantId,
          documentId: newDoc.id,
          model: extraction.model,
          payload: extraction.payload,
          tokensUsed: extraction.tokensUsed ?? undefined,
        });
        if (newDoc.docType === "invoice") {
          extractionResultId = newExtractionId;
        }
        await updateDocumentStatus({
          tenantId: params.tenantId,
          documentId: newDoc.id,
          status: "extracted",
        });
      }

      if (newDocs.some((doc) => doc.docType === "bill_of_lading")) {
        await syncImportEta({ tenantId: params.tenantId, importId });
      }

      documents = newDocs;

      tracker.importId = importId;

      const invoiceNumber =
        normalizeImportKey(invoice?.number) ??
        normalizeImportKey(packingList?.invoiceNumber);
      const blNumber =
        normalizeImportKey(bl?.number) ?? normalizeImportKey(invoice?.blNumber);
      const supplierName =
        invoice?.exporter.name?.trim() || bl?.shipper?.trim() || null;

      await fillImportKeysIfEmpty({
        tenantId: params.tenantId,
        importId,
        invoiceNumber,
        blNumber,
        supplierName,
      });
      await clearAutoReferenceIfNeeded({
        tenantId: params.tenantId,
        importId,
      });
      await fillImportReferenceIfEmpty({
        tenantId: params.tenantId,
        importId,
        referenceNumber: extractImportReference({
          filename: file.filename,
          invoiceNumber,
          blNumber,
        })?.value,
      });

      await updateImportStatus({
        tenantId: params.tenantId,
        importId,
        status: "awaiting_review",
      });
    }
  }

  tracker.importId = importId;

  const defaultConsignee = await applyDefaultConsignee({
    tenantId: params.tenantId,
    importId,
    invoice,
    bl,
  });

  let pendingParties: PendingParty[] = [];
  if (invoice) {
    try {
      pendingParties = await resolveInvoiceParties({
        tenantId: params.tenantId,
        importId,
        invoice,
        skipConsignee: Boolean(defaultConsignee),
      });
    } catch (partyErr) {
      log.warn("parties_resolve_failed", {
        importId,
        docType: "invoice",
        recycled: true,
        error: partyErr,
      });
      const fallback = pendingPartiesFromInvoice(invoice);
      pendingParties = defaultConsignee
        ? withoutConsigneeRoles(fallback)
        : fallback;
    }
  }

  if (bl) {
    try {
      const blPendingParties = await resolveBlParties({
        tenantId: params.tenantId,
        importId,
        bl,
        skipConsignee: Boolean(defaultConsignee),
      });
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...blPendingParties,
      ]);
    } catch (partyErr) {
      log.warn("parties_resolve_failed", {
        importId,
        docType: "bill_of_lading",
        recycled: true,
        error: partyErr,
      });
      const fallback = pendingPartiesFromBl(bl);
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...(defaultConsignee ? withoutConsigneeRoles(fallback) : fallback),
      ]);
    }
  }

  log.info("pipeline_deduped", {
    tenantId: params.tenantId,
    importId,
    types,
    documents: documents.length,
    latencyMs: Date.now() - started,
  });

  // Reenvio do mesmo arquivo também garante o rastreio: se a primeira análise
  // não conseguiu enfileirar, subir o arquivo de novo recupera o embarque (o
  // enqueue é idempotente e `ignoreDuplicates` não mexe no que já existe).
  const trackingPending = bl
    ? await enqueueTrackingBestEffort({
        tenantId: params.tenantId,
        importId,
        bl,
        blNumber: normalizeImportKey(bl.number),
      })
    : false;

  return {
    importId,
    types,
    documents,
    invoice,
    extractionResultId,
    pendingParties,
    model,
    latencyMs: Date.now() - started,
    deduped: true,
    trackingPending,
  };
}

/**
 * Enfileira o rastreio sem derrubar a análise. Tenta 3 vezes (falhas de conexão
 * já tiraram o rastreio de um BL), e quando desiste grava o motivo em `ai_logs`
 * — os runtime logs da Vercel não estão consultáveis, então o banco é a única
 * fonte do erro real.
 */
async function enqueueTrackingBestEffort(params: {
  tenantId: string;
  importId: string;
  /** Payload do BL já carregado (evita reler a importação). */
  bl?: BlExtraction | null;
  blNumber?: string | null;
}): Promise<boolean> {
  const delays = [300, 1_200];
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await enqueueTrackingForImport(params);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < delays.length) {
        log.warn("tracking_enqueue_retry", {
          tenantId: params.tenantId,
          importId: params.importId,
          attempt: attempt + 1,
          error,
        });
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  log.error("tracking_enqueue_failed", {
    tenantId: params.tenantId,
    importId: params.importId,
    error: lastError,
  });

  try {
    await persistAiLog({
      tenantId: params.tenantId,
      capability: "tracking_enqueue",
      model: "tracking",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      status: "error",
      errorMessage:
        lastError instanceof Error
          ? `${lastError.name}: ${lastError.message}`
          : String(lastError),
      importId: params.importId,
    });
  } catch (logError) {
    log.error("tracking_enqueue_log_failed", {
      importId: params.importId,
      error: logError,
    });
  }

  return false;
}

/**
 * Executa a análise e, em caso de falha, marca a importação como `failed`
 * antes de propagar o erro (o estado parcial fica explícito e reprocessável).
 */
export async function runAnalyzePipeline(params: {
  tenantId: string;
  userId: string;
  file: File;
  startedAt?: number;
  importId?: string;
  /** PDF bruto do job no Storage: evita reenviar os bytes. */
  sourceStoragePath?: string;
}): Promise<AnalyzePipelineResult> {
  return runWithLogContext(
    {
      tenantId: params.tenantId,
      userId: params.userId,
      importId: params.importId,
      filename: params.file.name,
    },
    () =>
      withSpan(
        "ai.analyze",
        params.importId
          ? { "tenant.id": params.tenantId, "import.id": params.importId }
          : { "tenant.id": params.tenantId },
        async (span) => {
          const tracker: PipelineTracker = {};
          const timer = createTimer();
          log.info("pipeline_started", {
            filename: params.file.name,
            mediaType: params.file.type,
            bytes: params.file.size,
            existingImportId: params.importId,
          });

          try {
            const result = await executeAnalyzePipeline(params, tracker);
            span.setAttributes({
              "import.id": result.importId,
              "ai.deduped": result.deduped,
              "ai.types": result.types.join(","),
              "ai.latency_ms": result.latencyMs,
            });
            log.info("pipeline_succeeded", {
              importId: result.importId,
              types: result.types,
              documents: result.documents.length,
              model: result.model,
              deduped: result.deduped,
              latencyMs: result.latencyMs,
              elapsedMs: timer.elapsedMs(),
            });
            return result;
          } catch (error) {
            log.error("pipeline_failed", {
              importId: tracker.importId,
              filename: params.file.name,
              elapsedMs: timer.elapsedMs(),
              error,
            });
            if (tracker.importId) {
              try {
                await updateImportStatus({
                  tenantId: params.tenantId,
                  importId: tracker.importId,
                  status: "failed",
                });
              } catch (statusError) {
                log.error("import_status_failed", {
                  importId: tracker.importId,
                  status: "failed",
                  error: statusError,
                });
              }
            }
            throw error;
          }
        },
      ),
  );
}

async function executeAnalyzePipeline(
  params: {
    tenantId: string;
    userId: string;
    file: File;
    startedAt?: number;
    importId?: string;
    sourceStoragePath?: string;
  },
  tracker: PipelineTracker,
): Promise<AnalyzePipelineResult> {
  const started = params.startedAt ?? Date.now();

  const filename = params.file.name || "documento";
  const mediaType = normalizeMediaType(params.file.type, filename);
  const buffer = new Uint8Array(await params.file.arrayBuffer());
  assertAllowedFile(buffer.byteLength, mediaType);
  const digest = sha256Hex(buffer);
  const fileInput: AnalyzeFileInput = { bytes: buffer, mediaType, filename };

  log.info("document_received", {
    filename,
    mediaType,
    bytes: buffer.byteLength,
    sha256: digest.slice(0, 12),
  });

  const reusable = await findReusableUpload(params.tenantId, digest);
  if (reusable) {
    return buildReusableResult(
      params,
      reusable,
      { buffer, digest, filename, mediaType },
      started,
      tracker,
    );
  }

  // Config global de IA (provider/modelo); falha aqui não bloqueia (usa env).
  let overrides: AiOverrides = {};
  try {
    overrides = await getAiOverrides();
  } catch (overridesError) {
    log.warn("ai_overrides_unavailable", { error: overridesError });
  }
  const modelId = (() => {
    try {
      return getAiModelId(overrides);
    } catch {
      return "unknown";
    }
  })();

  const aiLogIds: string[] = [];
  async function logAi(params: Parameters<typeof persistAiLog>[0]) {
    recordAiCall({
      capability: params.capability,
      model: params.model,
      status: params.status,
      tokensIn: params.tokensIn,
      tokensOut: params.tokensOut,
      latencyMs: params.latencyMs,
      costUsd: params.costUsd,
    });
    const id = await persistAiLog(params);
    if (id) aiLogIds.push(id);
  }

  let prepared: PreparedDocument;
  let classifyResult: {
    classification: DocumentClassification;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    usage: AiTaskUsage;
  };
  try {
    const classified = await withSpan(
      "ai.classify",
      { "ai.model": modelId },
      async (span) => {
        // Prepara uma única vez (PDF → markdown ou imagens) e reutiliza nas
        // quatro tasks abaixo.
        const preparedDocument = await prepareDocument(fileInput, overrides, {
          tenantId: params.tenantId,
          sha256: digest,
        });

        // 1º) classificação determinística pelo markdown (sem IA, sem custo).
        const heuristic = detectDocumentTypes({
          filename,
          text: preparedDocumentText(preparedDocument.content),
        });
        if (heuristic) {
          span.setAttributes({
            "ai.classification_source": "heuristic",
            "ai.types": heuristic.types.join(","),
            "ai.tokens_in": 0,
            "ai.tokens_out": 0,
            "ai.latency_ms": 0,
          });
          return {
            prepared: preparedDocument,
            result: {
              classification: { types: heuristic.types, notes: null },
              model: "heuristic",
              tokensIn: 0,
              tokensOut: 0,
              latencyMs: 0,
              usage: {
                tokensIn: 0,
                tokensOut: 0,
                reasoningTokens: 0,
                costUsd: 0,
                latencyMs: 0,
              },
            },
            source: "heuristic" as const,
          };
        }

        // 2º) fallback: o modelo configurado classifica.
        const result = await classifyDocument(preparedDocument);
        span.setAttributes({
          "ai.classification_source": "model",
          "ai.model": result.model,
          "ai.tokens_in": result.tokensIn,
          "ai.tokens_out": result.tokensOut,
          "ai.latency_ms": result.latencyMs,
        });
        return { prepared: preparedDocument, result, source: "model" as const };
      },
    );
    prepared = classified.prepared;
    classifyResult = classified.result;
    log.info("document_classified", {
      source: classified.source,
      types: classifyResult.classification.types,
      model: classifyResult.model,
      latencyMs: classifyResult.latencyMs,
      tokensIn: classifyResult.tokensIn,
      tokensOut: classifyResult.tokensOut,
      parse: classified.prepared.parse ?? null,
    });
    await logAi({
      tenantId: params.tenantId,
      capability: "classify",
      model: classifyResult.model,
      tokensIn: classifyResult.tokensIn,
      tokensOut: classifyResult.tokensOut,
      latencyMs: classifyResult.latencyMs,
      status: "success",
      costUsd: classifyResult.usage.costUsd,
      reasoningTokens: classifyResult.usage.reasoningTokens,
    });
  } catch (err) {
    await logAi({
      tenantId: params.tenantId,
      capability: "classify",
      model: modelId,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - started,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const types = classifyResult.classification.types;
  let invoice: InvoiceExtraction | null = null;
  let invoiceModel = classifyResult.model;
  let invoiceTokensUsed: number | null = null;
  let packingList: PackingListExtraction | null = null;
  let packingListModel = classifyResult.model;
  let packingListTokensUsed: number | null = null;
  let bl: BlExtraction | null = null;
  let blModel = classifyResult.model;
  let blTokensUsed: number | null = null;
  // Erros por tipo: a extração pode falhar sem derrubar a análise inteira, mas
  // o documento precisa ficar `failed` (nunca `pending` para sempre).
  const extractionErrors: Partial<Record<DocumentType, string>> = {};

  /**
   * As três extrações são independentes (mesmo documento preparado, schemas
   * distintos) e rodam em paralelo: a análise passa a durar o maior passo em
   * vez da soma. Antes, um PDF com Invoice + Packing List + BL encadeava três
   * chamadas de IA — cada uma com orçamento próprio de timeout.
   */
  async function runInvoiceExtraction(): Promise<{
    invoice: InvoiceExtraction;
    model: string;
    tokensUsed: number;
  }> {
    try {
      const extracted = await withSpan(
        "ai.extract_invoice",
        { "ai.model": modelId },
        async (span) => {
          const result = await extractInvoice(prepared);
          span.setAttributes({
            "ai.model": result.model,
            "ai.tokens_in": result.tokensIn,
            "ai.tokens_out": result.tokensOut,
            "ai.latency_ms": result.latencyMs,
          });
          return result;
        },
      );
      log.info("document_extracted", {
        docType: "invoice",
        model: extracted.model,
        latencyMs: extracted.latencyMs,
        tokens: { in: extracted.tokensIn, out: extracted.tokensOut },
        invoiceNumber: extracted.invoice.number,
      });
      await logAi({
        tenantId: params.tenantId,
        capability: "extract_invoice",
        model: extracted.model,
        tokensIn: extracted.tokensIn,
        tokensOut: extracted.tokensOut,
        latencyMs: extracted.latencyMs,
        status: "success",
        costUsd: extracted.usage.costUsd,
        reasoningTokens: extracted.usage.reasoningTokens,
      });
      return {
        invoice: extracted.invoice,
        model: extracted.model,
        tokensUsed: extracted.tokensIn + extracted.tokensOut,
      };
    } catch (err) {
      await logAi({
        tenantId: params.tenantId,
        capability: "extract_invoice",
        model: modelId,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async function runPackingListExtraction(): Promise<{
    packingList: PackingListExtraction;
    model: string;
    tokensUsed: number;
  } | null> {
    try {
      const extracted = await withSpan(
        "ai.extract_packing_list",
        { "ai.model": modelId },
        async (span) => {
          const result = await extractPackingList(prepared);
          span.setAttributes({
            "ai.model": result.model,
            "ai.tokens_in": result.tokensIn,
            "ai.tokens_out": result.tokensOut,
            "ai.latency_ms": result.latencyMs,
          });
          return result;
        },
      );
      log.info("document_extracted", {
        docType: "packing_list",
        model: extracted.model,
        latencyMs: extracted.latencyMs,
        tokens: { in: extracted.tokensIn, out: extracted.tokensOut },
        invoiceNumber: extracted.packingList.invoiceNumber,
      });
      await logAi({
        tenantId: params.tenantId,
        capability: "extract_packing_list",
        model: extracted.model,
        tokensIn: extracted.tokensIn,
        tokensOut: extracted.tokensOut,
        latencyMs: extracted.latencyMs,
        status: "success",
        costUsd: extracted.usage.costUsd,
        reasoningTokens: extracted.usage.reasoningTokens,
      });
      return {
        packingList: extracted.packingList,
        model: extracted.model,
        tokensUsed: extracted.tokensIn + extracted.tokensOut,
      };
    } catch (err) {
      await logAi({
        tenantId: params.tenantId,
        capability: "extract_packing_list",
        model: modelId,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      extractionErrors.packing_list =
        err instanceof Error ? err.message : String(err);
      log.error("extraction_failed", {
        docType: "packing_list",
        model: modelId,
        error: err,
      });
      // Packing List é opcional: nunca derruba a análise.
      return null;
    }
  }

  async function runBlExtraction(): Promise<{
    bl: BlExtraction;
    model: string;
    tokensUsed: number;
  }> {
    try {
      const extracted = await withSpan(
        "ai.extract_bl",
        { "ai.model": modelId },
        async (span) => {
          const result = await extractBl(prepared);
          span.setAttributes({
            "ai.model": result.model,
            "ai.tokens_in": result.tokensIn,
            "ai.tokens_out": result.tokensOut,
            "ai.latency_ms": result.latencyMs,
          });
          return result;
        },
      );
      log.info("document_extracted", {
        docType: "bill_of_lading",
        model: extracted.model,
        latencyMs: extracted.latencyMs,
        tokens: { in: extracted.tokensIn, out: extracted.tokensOut },
        blNumber: extracted.bl.number,
        masterBlNumber: extracted.bl.masterBlNumber,
        carrier: extracted.bl.carrier,
      });
      await logAi({
        tenantId: params.tenantId,
        capability: "extract_bl",
        model: extracted.model,
        tokensIn: extracted.tokensIn,
        tokensOut: extracted.tokensOut,
        latencyMs: extracted.latencyMs,
        status: "success",
        costUsd: extracted.usage.costUsd,
        reasoningTokens: extracted.usage.reasoningTokens,
      });
      return {
        bl: extracted.bl,
        model: extracted.model,
        tokensUsed: extracted.tokensIn + extracted.tokensOut,
      };
    } catch (err) {
      await logAi({
        tenantId: params.tenantId,
        capability: "extract_bl",
        model: modelId,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      extractionErrors.bill_of_lading =
        err instanceof Error ? err.message : String(err);
      log.error("extraction_failed", {
        docType: "bill_of_lading",
        model: modelId,
        error: err,
      });
      throw err;
    }
  }

  const [invoiceOutcome, packingListOutcome, blOutcome] =
    await Promise.allSettled([
      types.includes("invoice")
        ? runInvoiceExtraction()
        : Promise.resolve(null),
      types.includes("packing_list")
        ? runPackingListExtraction()
        : Promise.resolve(null),
      types.includes("bill_of_lading")
        ? runBlExtraction()
        : Promise.resolve(null),
    ]);

  // Invoice é a espinha da importação: sem ela a análise não tem o que mostrar.
  // BL só derruba a análise quando não há Invoice para segurar o resultado.
  if (invoiceOutcome.status === "rejected") throw invoiceOutcome.reason;

  if (invoiceOutcome.status === "fulfilled" && invoiceOutcome.value) {
    invoice = invoiceOutcome.value.invoice;
    invoiceModel = invoiceOutcome.value.model;
    invoiceTokensUsed = invoiceOutcome.value.tokensUsed;
  }
  if (packingListOutcome.status === "fulfilled" && packingListOutcome.value) {
    packingList = packingListOutcome.value.packingList;
    packingListModel = packingListOutcome.value.model;
    packingListTokensUsed = packingListOutcome.value.tokensUsed;
  }
  if (blOutcome.status === "rejected") {
    if (!invoice) throw blOutcome.reason;
  } else if (blOutcome.value) {
    bl = blOutcome.value.bl;
    blModel = blOutcome.value.model;
    blTokensUsed = blOutcome.value.tokensUsed;
  }

  const invoiceNumber =
    normalizeImportKey(invoice?.number) ??
    normalizeImportKey(packingList?.invoiceNumber);
  const blNumber =
    normalizeImportKey(bl?.number) ?? normalizeImportKey(invoice?.blNumber);
  const supplierName =
    invoice?.exporter.name?.trim() || bl?.shipper?.trim() || null;

  let importId: string;
  if (params.importId) {
    await getImportDetail(params.tenantId, params.importId);
    await fillImportKeysIfEmpty({
      tenantId: params.tenantId,
      importId: params.importId,
      invoiceNumber,
      blNumber,
      supplierName,
    });
    await clearAutoReferenceIfNeeded({
      tenantId: params.tenantId,
      importId: params.importId,
    });
    importId = params.importId;
  } else {
    const created = await findOrCreateImport({
      tenantId: params.tenantId,
      userId: params.userId,
      invoiceNumber,
      blNumber,
      supplierName,
    });
    importId = created.importId;
  }

  tracker.importId = importId;

  log.info("import_resolved", {
    importId,
    created: !params.importId,
    invoiceNumber,
    blNumber,
    supplierName,
    types,
  });

  // Referência da importação vinda do próprio arquivo (campo do documento ou
  // código do nome do arquivo). Nunca sobrescreve o que o usuário digitou.
  try {
    const reference = extractImportReference({
      filename,
      markdown: preparedDocumentText(prepared.content),
      invoiceNumber,
      blNumber,
    });
    if (reference) {
      await fillImportReferenceIfEmpty({
        tenantId: params.tenantId,
        importId,
        referenceNumber: reference.value,
      });
    }
  } catch (referenceError) {
    log.warn("import_reference_failed", {
      tenantId: params.tenantId,
      importId,
      error: referenceError,
    });
  }

  try {
    await attachAiLogsToImport({
      tenantId: params.tenantId,
      importId,
      logIds: aiLogIds,
    });
  } catch (logErr) {
    log.warn("ai_logs_attach_failed", {
      tenantId: params.tenantId,
      importId,
      logIds: aiLogIds.length,
      error: logErr,
    });
  }

  const existingByHash = await findDocumentsBySha256({
    tenantId: params.tenantId,
    importId,
    sha256: digest,
  });

  let extractionResultId: string | null = null;
  const shouldPersist =
    existingByHash.length === 0 ||
    existingByHash.some((document) => document.status !== "extracted");

  let documents: Array<{ id: string; docType: DocumentType }> =
    existingByHash.map(({ id, docType }) => ({ id, docType }));

  if (existingByHash.length === 0) {
    const storagePath = await buildUniqueStoragePath({
      tenantId: params.tenantId,
      importId,
      filename,
      digest,
    });
    await persistImportFile({
      storagePath,
      bytes: buffer,
      mediaType,
      sourceStoragePath: params.sourceStoragePath,
    });

    documents = await insertDocuments({
      tenantId: params.tenantId,
      importId,
      types,
      storagePath,
      sha256: digest,
      filename,
      mediaType,
      sizeBytes: buffer.byteLength,
    });
  }

  if (shouldPersist) {
    const invoiceDoc = documents.find((d) => d.docType === "invoice");
    const packingListDoc = documents.find((d) => d.docType === "packing_list");
    const blDoc = documents.find((d) => d.docType === "bill_of_lading");

    if (invoice && invoiceDoc) {
      try {
        extractionResultId = await persistExtractionWithSpan({
          tenantId: params.tenantId,
          documentId: invoiceDoc.id,
          model: invoiceModel,
          payload: invoice,
          tokensUsed: invoiceTokensUsed ?? undefined,
        });
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: invoiceDoc.id,
            status: "extracted",
          });
        } catch (statusErr) {
          log.warn("document_status_failed", {
            tenantId: params.tenantId,
            importId,
            documentId: invoiceDoc.id,
            docType: "invoice",
            status: "extracted",
            extractionSaved: true,
            error: statusErr,
          });
        }
      } catch (persistErr) {
        log.error("extraction_persist_failed", {
          tenantId: params.tenantId,
          importId,
          documentId: invoiceDoc.id,
          docType: "invoice",
          error: persistErr,
        });
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: invoiceDoc.id,
            status: "failed",
          });
        } catch (failedErr) {
          log.error("document_status_failed", {
            tenantId: params.tenantId,
            importId,
            documentId: invoiceDoc.id,
            docType: "invoice",
            status: "failed",
            error: failedErr,
          });
        }
      }
    }

    if (packingList && packingListDoc) {
      try {
        await persistExtractionWithSpan({
          tenantId: params.tenantId,
          documentId: packingListDoc.id,
          model: packingListModel,
          payload: packingList,
          tokensUsed: packingListTokensUsed ?? undefined,
        });
        await updateDocumentStatus({
          tenantId: params.tenantId,
          documentId: packingListDoc.id,
          status: "extracted",
        });
      } catch (persistErr) {
        log.error("extraction_persist_failed", {
          tenantId: params.tenantId,
          importId,
          documentId: packingListDoc.id,
          docType: "packing_list",
          error: persistErr,
        });
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: packingListDoc.id,
            status: "failed",
          });
        } catch (failedErr) {
          log.error("document_status_failed", {
            tenantId: params.tenantId,
            importId,
            documentId: packingListDoc.id,
            docType: "packing_list",
            status: "failed",
            error: failedErr,
          });
        }
      }
    }

    if (bl && blDoc) {
      try {
        await persistExtractionWithSpan({
          tenantId: params.tenantId,
          documentId: blDoc.id,
          model: blModel,
          payload: bl,
          tokensUsed: blTokensUsed ?? undefined,
        });
        await syncImportEta({ tenantId: params.tenantId, importId });
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: blDoc.id,
            status: "extracted",
          });
        } catch (statusErr) {
          log.warn("document_status_failed", {
            tenantId: params.tenantId,
            importId,
            documentId: blDoc.id,
            docType: "bill_of_lading",
            status: "extracted",
            extractionSaved: true,
            error: statusErr,
          });
        }
      } catch (persistErr) {
        log.error("extraction_persist_failed", {
          tenantId: params.tenantId,
          importId,
          documentId: blDoc.id,
          docType: "bill_of_lading",
          error: persistErr,
        });
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: blDoc.id,
            status: "failed",
          });
        } catch (failedErr) {
          log.error("document_status_failed", {
            tenantId: params.tenantId,
            importId,
            documentId: blDoc.id,
            docType: "bill_of_lading",
            status: "failed",
            error: failedErr,
          });
        }
      }
    }
  }

  // Extração que falhou não pode deixar o documento `pending` para sempre: a
  // importação fica com os demais resultados, mas o documento sinaliza falha
  // (e o motivo já está em `ai_logs`).
  if (shouldPersist) {
    const previouslyExtracted = new Set(
      existingByHash
        .filter((document) => document.status === "extracted")
        .map((document) => document.id),
    );

    for (const document of documents) {
      if (!extractionErrors[document.docType]) continue;
      if (previouslyExtracted.has(document.id)) continue;

      try {
        await updateDocumentStatus({
          tenantId: params.tenantId,
          documentId: document.id,
          status: "failed",
        });
      } catch (statusError) {
        log.error("document_status_failed", {
          tenantId: params.tenantId,
          importId,
          documentId: document.id,
          docType: document.docType,
          status: "failed",
          error: statusError,
        });
      }
    }
  }

  if (!shouldPersist) {
    await fillImportKeysIfEmpty({
      tenantId: params.tenantId,
      importId,
      invoiceNumber,
      blNumber,
      supplierName,
    });
  }

  // Rastreio, consignee e status são independentes entre si e do resultado da
  // análise: as três escritas saem juntas (o enqueue usa o BL que acabou de ser
  // persistido, sem reler a importação).
  const trackingPromise = bl
    ? enqueueTrackingBestEffort({
        tenantId: params.tenantId,
        importId,
        bl,
        blNumber,
      })
    : Promise.resolve(false);

  const consigneePromise = applyDefaultConsignee({
    tenantId: params.tenantId,
    importId,
    invoice,
    bl,
  });

  const statusPromise = updateImportStatus({
    tenantId: params.tenantId,
    importId,
    status: "awaiting_review",
  }).catch((statusErr) => {
    log.error("import_status_failed", {
      tenantId: params.tenantId,
      importId,
      status: "awaiting_review",
      error: statusErr,
    });
  });

  const [defaultConsignee] = await Promise.all([
    consigneePromise,
    statusPromise,
  ]);

  let pendingParties: PendingParty[] = [];
  if (invoice) {
    try {
      pendingParties = await resolveInvoiceParties({
        tenantId: params.tenantId,
        importId,
        invoice,
        skipConsignee: Boolean(defaultConsignee),
      });
    } catch (partyErr) {
      log.warn("parties_resolve_failed", {
        importId,
        docType: "invoice",
        error: partyErr,
      });
      const fallback = pendingPartiesFromInvoice(invoice);
      pendingParties = defaultConsignee
        ? withoutConsigneeRoles(fallback)
        : fallback;
    }
  }

  if (bl) {
    try {
      const blPendingParties = await resolveBlParties({
        tenantId: params.tenantId,
        importId,
        bl,
        skipConsignee: Boolean(defaultConsignee),
      });
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...blPendingParties,
      ]);
    } catch (partyErr) {
      log.warn("parties_resolve_failed", {
        importId,
        docType: "bill_of_lading",
        error: partyErr,
      });
      const fallback = pendingPartiesFromBl(bl);
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...(defaultConsignee ? withoutConsigneeRoles(fallback) : fallback),
      ]);
    }
  }

  const trackingPending = await trackingPromise;

  return {
    importId,
    types,
    documents,
    invoice,
    extractionResultId,
    pendingParties,
    model: classifyResult.model,
    latencyMs: Date.now() - started,
    deduped: false,
    trackingPending,
  };
}
