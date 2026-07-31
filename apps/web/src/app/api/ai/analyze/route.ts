import { NextResponse } from "next/server";
import { classifyDocument } from "@/lib/ai/classify";
import { extractInvoice } from "@/lib/ai/extract-invoice";
import {
  assertAllowedFile,
  normalizeMediaType,
  sha256Hex,
} from "@/lib/ai/file-utils";
import { OpenRouterConfigError, getOpenRouterModel } from "@/lib/ai";
import type { DocumentType, InvoiceExtraction } from "@/lib/ai/schemas";
import { getAuthContext, UnauthorizedError } from "@/lib/auth";
import {
  buildStoragePath,
  createImportRecord,
  insertDocuments,
  persistAiLog,
  persistExtractionResult,
  updateDocumentStatus,
  updateImportStatus,
  uploadImportFile,
} from "@/lib/documents/persist";

export const runtime = "nodejs";
export const maxDuration = 120;

type AnalyzeSuccess = {
  importId: string;
  types: DocumentType[];
  documents: Array<{ id: string; docType: DocumentType }>;
  invoice: InvoiceExtraction | null;
  model: string;
  latencyMs: number;
};

export async function POST(request: Request) {
  const started = Date.now();
  let tenantIdForLog: string | null = null;
  const modelId = (() => {
    try {
      return getOpenRouterModel();
    } catch {
      return "unknown";
    }
  })();

  try {
    const auth = await getAuthContext();
    tenantIdForLog = auth.tenantId;

    if (auth.role === "viewer") {
      return NextResponse.json(
        { error: "Perfil viewer não pode enviar documentos" },
        { status: 403 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Campo file é obrigatório" },
        { status: 400 },
      );
    }

    const filename = file.name || "documento";
    const mediaType = normalizeMediaType(file.type, filename);
    const buffer = new Uint8Array(await file.arrayBuffer());
    assertAllowedFile(buffer.byteLength, mediaType);
    const digest = sha256Hex(buffer);

    const referenceNumber = `IMP-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}-${digest.slice(0, 6)}`;

    const importId = await createImportRecord({
      tenantId: auth.tenantId,
      userId: auth.userId,
      referenceNumber,
    });

    const storagePath = buildStoragePath(auth.tenantId, importId, filename);
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
        tenantId: auth.tenantId,
        capability: "classify",
        model: classifyResult.model,
        tokensIn: classifyResult.tokensIn,
        tokensOut: classifyResult.tokensOut,
        latencyMs: classifyResult.latencyMs,
        status: "success",
      });
    } catch (err) {
      await persistAiLog({
        tenantId: auth.tenantId,
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
      tenantId: auth.tenantId,
      importId,
      types,
      storagePath,
      sha256: digest,
      filename,
      mediaType,
      sizeBytes: buffer.byteLength,
    });

    let invoice: InvoiceExtraction | null = null;
    const invoiceDoc = documents.find((d) => d.docType === "invoice");

    if (invoiceDoc) {
      try {
        const extracted = await extractInvoice(fileInput);
        invoice = extracted.invoice;
        await persistAiLog({
          tenantId: auth.tenantId,
          capability: "extract_invoice",
          model: extracted.model,
          tokensIn: extracted.tokensIn,
          tokensOut: extracted.tokensOut,
          latencyMs: extracted.latencyMs,
          status: "success",
        });
        await persistExtractionResult({
          tenantId: auth.tenantId,
          documentId: invoiceDoc.id,
          model: extracted.model,
          payload: extracted.invoice,
          tokensUsed: extracted.tokensIn + extracted.tokensOut,
        });
        await updateDocumentStatus(invoiceDoc.id, "extracted");
        await updateImportStatus(importId, "awaiting_review", {
          supplierName: extracted.invoice.exporter.name,
        });
      } catch (err) {
        await persistAiLog({
          tenantId: auth.tenantId,
          capability: "extract_invoice",
          model: modelId,
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: Date.now() - started,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        await updateDocumentStatus(invoiceDoc.id, "failed");
        await updateImportStatus(importId, "awaiting_review");
        throw err;
      }
    } else {
      await updateImportStatus(importId, "awaiting_review");
    }

    const body: AnalyzeSuccess = {
      importId,
      types,
      documents,
      invoice,
      model: classifyResult.model,
      latencyMs: Date.now() - started,
    };

    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 },
      );
    }
    if (error instanceof OpenRouterConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const message =
      error instanceof Error ? error.message : "Falha ao analisar documento";

    if (
      message.includes("SUPABASE_SERVICE_ROLE_KEY") ||
      message.includes("SUPABASE_SECRET_KEY")
    ) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    if (
      message.includes("não suportado") ||
      message.includes("Arquivo") ||
      message.includes("obrigatório")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (/failed to parse/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Não foi possível ler o PDF. Tente reenviar, ou use PNG/JPG do documento.",
        },
        { status: 422 },
      );
    }

    console.error("[api/ai/analyze]", error);
    if (tenantIdForLog) {
      await persistAiLog({
        tenantId: tenantIdForLog,
        capability: "analyze",
        model: modelId,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        status: "error",
        errorMessage: message,
      });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
