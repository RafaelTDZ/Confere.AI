import { classifyDocument } from "@/lib/ai/classify";
import { extractInvoice } from "@/lib/ai/extract-invoice";
import {
  assertAllowedFile,
  normalizeMediaType,
  sha256Hex,
} from "@/lib/ai/file-utils";
import { getOpenRouterModel } from "@/lib/ai";
import type { DocumentType, InvoiceExtraction } from "@/lib/ai/schemas";
import { persistAiLog } from "@/lib/documents/ai-logs";
import { insertDocuments, updateDocumentStatus } from "@/lib/documents/documents";
import {
  createImportRecord,
  updateImportStatus,
} from "@/lib/documents/imports";
import { persistExtractionResult } from "@/lib/documents/extractions";
import { buildStoragePath, uploadImportFile } from "@/lib/documents/storage";

export type AnalyzePipelineResult = {
  importId: string;
  types: DocumentType[];
  documents: Array<{ id: string; docType: DocumentType }>;
  invoice: InvoiceExtraction | null;
  extractionResultId: string | null;
  model: string;
  latencyMs: number;
};

export async function runAnalyzePipeline(params: {
  tenantId: string;
  userId: string;
  file: File;
  startedAt?: number;
}): Promise<AnalyzePipelineResult> {
  const started = params.startedAt ?? Date.now();
  const modelId = (() => {
    try {
      return getOpenRouterModel();
    } catch {
      return "unknown";
    }
  })();

  const filename = params.file.name || "documento";
  const mediaType = normalizeMediaType(params.file.type, filename);
  const buffer = new Uint8Array(await params.file.arrayBuffer());
  assertAllowedFile(buffer.byteLength, mediaType);
  const digest = sha256Hex(buffer);

  const referenceNumber = `IMP-${new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "")}-${digest.slice(0, 6)}`;

  const importId = await createImportRecord({
    tenantId: params.tenantId,
    userId: params.userId,
    referenceNumber,
  });

  const storagePath = buildStoragePath(params.tenantId, importId, filename);
  await uploadImportFile({
    storagePath,
    bytes: buffer,
    mediaType,
  });

  const fileInput = { bytes: buffer, mediaType, filename };

  let classifyResult;
  try {
    classifyResult = await classifyDocument(fileInput);
    await persistAiLog({
      tenantId: params.tenantId,
      capability: "classify",
      model: classifyResult.model,
      tokensIn: classifyResult.tokensIn,
      tokensOut: classifyResult.tokensOut,
      latencyMs: classifyResult.latencyMs,
      status: "success",
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
    await updateImportStatus(importId, "rejected");
    throw err;
  }

  const types = classifyResult.classification.types;
  const documents = await insertDocuments({
    tenantId: params.tenantId,
    importId,
    types,
    storagePath,
    sha256: digest,
    filename,
    mediaType,
    sizeBytes: buffer.byteLength,
  });

  let invoice: InvoiceExtraction | null = null;
  let extractionResultId: string | null = null;
  const invoiceDoc = documents.find((d) => d.docType === "invoice");

  if (invoiceDoc) {
    try {
      const extracted = await extractInvoice(fileInput);
      invoice = extracted.invoice;
      await persistAiLog({
        tenantId: params.tenantId,
        capability: "extract_invoice",
        model: extracted.model,
        tokensIn: extracted.tokensIn,
        tokensOut: extracted.tokensOut,
        latencyMs: extracted.latencyMs,
        status: "success",
      });
      extractionResultId = await persistExtractionResult({
        tenantId: params.tenantId,
        documentId: invoiceDoc.id,
        model: extracted.model,
        payload: extracted.invoice,
        tokensUsed: extracted.tokensIn + extracted.tokensOut,
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
      try {
        await updateDocumentStatus(invoiceDoc.id, "failed");
      } catch (statusErr) {
        console.error(
          "[analyze-pipeline] falha ao marcar documento failed:",
          statusErr,
        );
      }
      await updateImportStatus(importId, "awaiting_review");
      throw err;
    }

    // Payload já está em extraction_results — status é best-effort.
    try {
      await updateDocumentStatus(invoiceDoc.id, "extracted");
      await updateImportStatus(importId, "awaiting_review", {
        supplierName: invoice?.exporter.name ?? null,
      });
    } catch (statusErr) {
      console.error(
        "[analyze-pipeline] extração salva, mas falha ao atualizar status:",
        statusErr,
      );
    }
  } else {
    await updateImportStatus(importId, "awaiting_review");
  }

  return {
    importId,
    types,
    documents,
    invoice,
    extractionResultId,
    model: classifyResult.model,
    latencyMs: Date.now() - started,
  };
}
