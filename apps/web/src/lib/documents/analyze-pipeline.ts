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
import { persistAiLog } from "@/lib/documents/ai-logs";
import {
  findDocumentsBySha256,
  insertDocuments,
  updateDocumentStatus,
} from "@/lib/documents/documents";
import {
  findOrCreateImport,
  fillImportKeysIfEmpty,
  clearAutoReferenceIfNeeded,
  getImportDetail,
  updateImportStatus,
} from "@/lib/documents/imports";
import { normalizeImportKey } from "@/lib/documents/imports-shared";
import { persistExtractionResult } from "@/lib/documents/extractions";
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
};

export async function runAnalyzePipeline(params: {
  tenantId: string;
  userId: string;
  file: File;
  startedAt?: number;
  importId?: string;
}): Promise<AnalyzePipelineResult> {
  const started = params.startedAt ?? Date.now();
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

  const filename = params.file.name || "documento";
  const mediaType = normalizeMediaType(params.file.type, filename);
  const buffer = new Uint8Array(await params.file.arrayBuffer());
  assertAllowedFile(buffer.byteLength, mediaType);
  const digest = sha256Hex(buffer);
  const fileInput = { bytes: buffer, mediaType, filename };

  let classifyResult;
  try {
    classifyResult = await classifyDocument(fileInput, overrides);
    await persistAiLog({
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
    await persistAiLog({
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
      await persistAiLog({
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
      await persistAiLog({
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
      await persistAiLog({
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
      await persistAiLog({
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
      await persistAiLog({
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
      await persistAiLog({
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
      importId: params.importId,
      invoiceNumber,
      blNumber,
      supplierName,
    });
    await clearAutoReferenceIfNeeded(params.importId);
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
      importId,
      invoiceNumber,
      blNumber,
      supplierName,
    });
  }

  try {
    await updateImportStatus(importId, "awaiting_review");
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
  };
}
