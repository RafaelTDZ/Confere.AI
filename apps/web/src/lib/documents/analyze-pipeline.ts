import "server-only";

import { classifyDocument } from "@/lib/ai/tasks/classify";
import { extractBl } from "@/lib/ai/tasks/extract-bl";
import { extractInvoice } from "@/lib/ai/tasks/extract-invoice";
import { extractPackingList } from "@/lib/ai/tasks/extract-packing-list";
import {
  assertAllowedFile,
  normalizeMediaType,
  sha256Hex,
} from "@/lib/ai/file-utils";
import { getAiModelId, type AiOverrides } from "@/lib/ai";
import { getAiOverrides } from "@/lib/settings/ai-settings";
import type {
  BlExtraction,
  DocumentType,
  InvoiceExtraction,
  PackingListExtraction,
} from "@/lib/ai/schemas";
import {
  attachAiLogsToImport,
  persistAiLog,
} from "@/lib/documents/ai-logs";
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
  clearAutoReferenceIfNeeded,
  getImportDetail,
  updateImportStatus,
} from "@/lib/documents/imports";
import {
  IMPORT_DOCUMENT_TYPES,
  normalizeImportKey,
} from "@/lib/documents/imports-shared";
import {
  findLatestExtractionsByDocumentIds,
  persistExtractionResult,
  type LatestExtraction,
} from "@/lib/documents/extractions";
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
  uploadImportFile,
} from "@/lib/documents/storage";

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
};

type AnalyzePipelineParams = {
  tenantId: string;
  userId: string;
  file: File;
  startedAt?: number;
  importId?: string;
};

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

type PipelineTracker = { importId?: string };

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
      await uploadImportFile({
        storagePath,
        bytes: file.buffer,
        mediaType: file.mediaType,
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
        const extraction = extractionForType(
          docs,
          extractions,
          newDoc.docType,
        );
        if (!extraction) continue;

        const newExtractionId = await persistExtractionResult({
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

      await updateImportStatus({
        tenantId: params.tenantId,
        importId,
        status: "awaiting_review",
      });
    }
  }

  let pendingParties: PendingParty[] = [];
  if (invoice) {
    try {
      pendingParties = await resolveInvoiceParties({
        tenantId: params.tenantId,
        importId,
        invoice,
      });
    } catch (partyErr) {
      console.error(
        "[analyze-pipeline] falha ao resolver consignee/notify (cache):",
        partyErr,
      );
      pendingParties = pendingPartiesFromInvoice(invoice);
    }
  }

  if (bl) {
    try {
      const blPendingParties = await resolveBlParties({
        tenantId: params.tenantId,
        importId,
        bl,
      });
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...blPendingParties,
      ]);
    } catch (partyErr) {
      console.error(
        "[analyze-pipeline] falha ao resolver consignee/notify do BL (cache):",
        partyErr,
      );
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...pendingPartiesFromBl(bl),
      ]);
    }
  }

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
  };
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
}): Promise<AnalyzePipelineResult> {
  const tracker: PipelineTracker = {};

  try {
    return await executeAnalyzePipeline(params, tracker);
  } catch (error) {
    if (tracker.importId) {
      try {
        await updateImportStatus({
          tenantId: params.tenantId,
          importId: tracker.importId,
          status: "failed",
        });
      } catch (statusError) {
        console.error(
          "[analyze-pipeline] falha ao marcar importação como failed:",
          statusError,
        );
      }
    }
    throw error;
  }
}

async function executeAnalyzePipeline(
  params: {
    tenantId: string;
    userId: string;
    file: File;
    startedAt?: number;
    importId?: string;
  },
  tracker: PipelineTracker,
): Promise<AnalyzePipelineResult> {
  const started = params.startedAt ?? Date.now();

  const filename = params.file.name || "documento";
  const mediaType = normalizeMediaType(params.file.type, filename);
  const buffer = new Uint8Array(await params.file.arrayBuffer());
  assertAllowedFile(buffer.byteLength, mediaType);
  const digest = sha256Hex(buffer);
  const fileInput = { bytes: buffer, mediaType, filename };

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
    console.error("[analyze-pipeline] falha ao ler ai_overrides:", overridesError);
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
    const id = await persistAiLog(params);
    if (id) aiLogIds.push(id);
  }

  let classifyResult;
  try {
    classifyResult = await classifyDocument(fileInput, overrides);
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

  if (types.includes("invoice")) {
    try {
      const extracted = await extractInvoice(fileInput, overrides);
      invoice = extracted.invoice;
      invoiceModel = extracted.model;
      invoiceTokensUsed = extracted.tokensIn + extracted.tokensOut;
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

  if (types.includes("packing_list")) {
    try {
      const extracted = await extractPackingList(fileInput, overrides);
      packingList = extracted.packingList;
      packingListModel = extracted.model;
      packingListTokensUsed = extracted.tokensIn + extracted.tokensOut;
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
      console.error("[analyze-pipeline] falha ao extrair Packing List:", err);
    }
  }

  if (types.includes("bill_of_lading")) {
    try {
      const extracted = await extractBl(fileInput, overrides);
      bl = extracted.bl;
      blModel = extracted.model;
      blTokensUsed = extracted.tokensIn + extracted.tokensOut;
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
      if (!invoice) throw err;
    }
  }

  const invoiceNumber = normalizeImportKey(invoice?.number) ??
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

  try {
    await attachAiLogsToImport({
      tenantId: params.tenantId,
      importId,
      logIds: aiLogIds,
    });
  } catch (logErr) {
    console.error(
      "[analyze-pipeline] falha ao vincular ai_logs à importação:",
      logErr,
    );
  }

  const existingByHash = await findDocumentsBySha256({
    tenantId: params.tenantId,
    importId,
    sha256: digest,
  });

  let documents = existingByHash;
  let extractionResultId: string | null = null;

  if (existingByHash.length === 0) {
    const storagePath = await buildUniqueStoragePath({
      tenantId: params.tenantId,
      importId,
      filename,
      digest,
    });
    await uploadImportFile({
      storagePath,
      bytes: buffer,
      mediaType,
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

    const invoiceDoc = documents.find((d) => d.docType === "invoice");
    const packingListDoc = documents.find((d) => d.docType === "packing_list");
    const blDoc = documents.find((d) => d.docType === "bill_of_lading");

    if (invoice && invoiceDoc) {
      try {
        extractionResultId = await persistExtractionResult({
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
          console.error(
            "[analyze-pipeline] extração da invoice salva, mas falha ao atualizar status:",
            statusErr,
          );
        }
      } catch (persistErr) {
        console.error(
          "[analyze-pipeline] falha ao salvar extração da invoice:",
          persistErr,
        );
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: invoiceDoc.id,
            status: "failed",
          });
        } catch (failedErr) {
          console.error(
            "[analyze-pipeline] falha ao marcar invoice failed:",
            failedErr,
          );
        }
      }
    }

    if (packingList && packingListDoc) {
      try {
        await persistExtractionResult({
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
        console.error(
          "[analyze-pipeline] falha ao salvar extração do Packing List:",
          persistErr,
        );
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: packingListDoc.id,
            status: "failed",
          });
        } catch (failedErr) {
          console.error(
            "[analyze-pipeline] falha ao marcar Packing List failed:",
            failedErr,
          );
        }
      }
    }

    if (bl && blDoc) {
      try {
        await persistExtractionResult({
          tenantId: params.tenantId,
          documentId: blDoc.id,
          model: blModel,
          payload: bl,
          tokensUsed: blTokensUsed ?? undefined,
        });
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: blDoc.id,
            status: "extracted",
          });
        } catch (statusErr) {
          console.error(
            "[analyze-pipeline] extração do BL salva, mas falha ao atualizar status:",
            statusErr,
          );
        }
      } catch (persistErr) {
        console.error(
          "[analyze-pipeline] falha ao salvar extração do BL:",
          persistErr,
        );
        try {
          await updateDocumentStatus({
            tenantId: params.tenantId,
            documentId: blDoc.id,
            status: "failed",
          });
        } catch (failedErr) {
          console.error(
            "[analyze-pipeline] falha ao marcar BL failed:",
            failedErr,
          );
        }
      }
    }
  } else {
    await fillImportKeysIfEmpty({
      tenantId: params.tenantId,
      importId,
      invoiceNumber,
      blNumber,
      supplierName,
    });
  }

  try {
    await updateImportStatus({
      tenantId: params.tenantId,
      importId,
      status: "awaiting_review",
    });
  } catch (statusErr) {
    console.error(
      "[analyze-pipeline] falha ao atualizar status da importação:",
      statusErr,
    );
  }

  let pendingParties: PendingParty[] = [];
  if (invoice) {
    try {
      pendingParties = await resolveInvoiceParties({
        tenantId: params.tenantId,
        importId,
        invoice,
      });
    } catch (partyErr) {
      console.error(
        "[analyze-pipeline] falha ao resolver consignee/notify:",
        partyErr,
      );
      pendingParties = pendingPartiesFromInvoice(invoice);
    }
  }

  if (bl) {
    try {
      const blPendingParties = await resolveBlParties({
        tenantId: params.tenantId,
        importId,
        bl,
      });
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...blPendingParties,
      ]);
    } catch (partyErr) {
      console.error(
        "[analyze-pipeline] falha ao resolver consignee/notify do BL:",
        partyErr,
      );
      pendingParties = combinePendingParties([
        ...pendingParties,
        ...pendingPartiesFromBl(bl),
      ]);
    }
  }

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
  };
}
