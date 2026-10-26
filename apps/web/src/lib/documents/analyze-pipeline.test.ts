import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/ai/file-utils";
import type { PreparedDocument } from "@/lib/ai/document-content";
import type {
  BlExtraction,
  DocumentClassification,
  DocumentType,
  InvoiceExtraction,
  InvoiceParty,
  PackingListExtraction,
} from "@/lib/ai/schemas";
import { runAnalyzePipeline } from "@/lib/documents/analyze-pipeline";
import type { PendingParty } from "@/lib/documents/parties";

const mocks = vi.hoisted(() => ({
  classifyDocument: vi.fn(),
  extractInvoice: vi.fn(),
  extractPackingList: vi.fn(),
  extractBl: vi.fn(),
  prepareDocument: vi.fn(),
  getAiModelId: vi.fn(),
  getAiOverrides: vi.fn(),
  persistAiLog: vi.fn(),
  attachAiLogsToImport: vi.fn(),
  findDocumentsBySha256: vi.fn(),
  findTenantDocumentsBySha256: vi.fn(),
  insertDocuments: vi.fn(),
  updateDocumentStatus: vi.fn(),
  findOrCreateImport: vi.fn(),
  fillImportKeysIfEmpty: vi.fn(),
  clearAutoReferenceIfNeeded: vi.fn(),
  getImportDetail: vi.fn(),
  updateImportStatus: vi.fn(),
  persistExtractionResult: vi.fn(),
  findLatestExtractionsByDocumentIds: vi.fn(),
  buildUniqueStoragePath: vi.fn(),
  uploadImportFile: vi.fn(),
  resolveInvoiceParties: vi.fn(),
  resolveBlParties: vi.fn(),
  pendingPartiesFromInvoice: vi.fn(),
  pendingPartiesFromBl: vi.fn(),
  combinePendingParties: vi.fn(),
}));

vi.mock("@/lib/ai/tasks/classify", () => ({
  classifyDocument: mocks.classifyDocument,
}));

vi.mock("@/lib/ai/tasks/extract-invoice", () => ({
  extractInvoice: mocks.extractInvoice,
}));

vi.mock("@/lib/ai/tasks/extract-packing-list", () => ({
  extractPackingList: mocks.extractPackingList,
}));

vi.mock("@/lib/ai/tasks/extract-bl", () => ({
  extractBl: mocks.extractBl,
}));

vi.mock("@/lib/ai/document-content", () => ({
  prepareDocument: mocks.prepareDocument,
}));

vi.mock("@/lib/ai", () => ({
  getAiModelId: mocks.getAiModelId,
}));

vi.mock("@/lib/settings/ai-settings", () => ({
  getAiOverrides: mocks.getAiOverrides,
}));

vi.mock("@/lib/documents/ai-logs", () => ({
  attachAiLogsToImport: mocks.attachAiLogsToImport,
  persistAiLog: mocks.persistAiLog,
}));

vi.mock("@/lib/documents/documents", () => ({
  findDocumentsBySha256: mocks.findDocumentsBySha256,
  findTenantDocumentsBySha256: mocks.findTenantDocumentsBySha256,
  insertDocuments: mocks.insertDocuments,
  updateDocumentStatus: mocks.updateDocumentStatus,
}));

vi.mock("@/lib/documents/imports", () => ({
  findOrCreateImport: mocks.findOrCreateImport,
  fillImportKeysIfEmpty: mocks.fillImportKeysIfEmpty,
  clearAutoReferenceIfNeeded: mocks.clearAutoReferenceIfNeeded,
  getImportDetail: mocks.getImportDetail,
  updateImportStatus: mocks.updateImportStatus,
}));

vi.mock("@/lib/documents/extractions", () => ({
  persistExtractionResult: mocks.persistExtractionResult,
  findLatestExtractionsByDocumentIds: mocks.findLatestExtractionsByDocumentIds,
}));

vi.mock("@/lib/documents/storage", () => ({
  buildUniqueStoragePath: mocks.buildUniqueStoragePath,
  uploadImportFile: mocks.uploadImportFile,
}));

vi.mock("@/lib/documents/parties", () => ({
  resolveInvoiceParties: mocks.resolveInvoiceParties,
  resolveBlParties: mocks.resolveBlParties,
  pendingPartiesFromInvoice: mocks.pendingPartiesFromInvoice,
  pendingPartiesFromBl: mocks.pendingPartiesFromBl,
  combinePendingParties: mocks.combinePendingParties,
}));

const TENANT_ID = "tenant-a";
const USER_ID = "user-a";
const FILE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const FILE_DIGEST = sha256Hex(FILE_BYTES);

const PREPARED: PreparedDocument = {
  provider: "fireworks",
  modelId: "model-default",
  isPdf: true,
  filename: "invoice.pdf",
  content: [
    {
      type: "file",
      mediaType: "image/jpeg",
      filename: "invoice-pagina-1.jpg",
      data: new Uint8Array([1, 2, 3]),
    },
  ],
};

type AiLogEntry = {
  tenantId: string;
  capability: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "success" | "error";
  errorMessage?: string | null;
  costUsd?: number | null;
  reasoningTokens?: number;
};

function makeFile(): File {
  return new File([new Uint8Array(FILE_BYTES)], "invoice.pdf", {
    type: "application/pdf",
  });
}

function emptyAddress() {
  return {
    street: null,
    number: null,
    complement: null,
    postalCode: null,
    city: null,
    state: null,
    country: null,
    other: null,
  };
}

function makeParty(overrides: Partial<InvoiceParty> = {}): InvoiceParty {
  return {
    name: null,
    cnpj: null,
    address: emptyAddress(),
    ...overrides,
  };
}

function makeInvoice(
  overrides: Partial<InvoiceExtraction> = {},
): InvoiceExtraction {
  return {
    number: " inv-001 ",
    blNumber: " bl-001 ",
    exporter: { name: " Exporter Ltd " },
    importer: makeParty(),
    notify: makeParty(),
    products: [],
    ...overrides,
  };
}

function makePackingList(
  overrides: Partial<PackingListExtraction> = {},
): PackingListExtraction {
  return { invoiceNumber: "INV-001", ...overrides };
}

function makeBl(overrides: Partial<BlExtraction> = {}): BlExtraction {
  return {
    number: "BL-001",
    shipper: "Exporter Ltd",
    ...overrides,
  } as unknown as BlExtraction;
}

function makeClassification(types: DocumentType[]): DocumentClassification {
  return { types, notes: null };
}

function makeExtractionResult(
  key: "invoice" | "packingList" | "bl",
  payload: unknown,
  model: string,
) {
  return {
    [key]: payload,
    model,
    tokensIn: 20,
    tokensOut: 8,
    latencyMs: 80,
    usage: { costUsd: 0.02, reasoningTokens: 0 },
  };
}

type TenantDocumentByShaFixture = {
  id: string;
  docType: DocumentType;
  importId: string;
  storagePath: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  version: number;
  createdAt: string;
};

function makeTenantDoc(
  overrides: Partial<TenantDocumentByShaFixture> &
    Pick<TenantDocumentByShaFixture, "id" | "docType">,
): TenantDocumentByShaFixture {
  return {
    importId: "import-old",
    storagePath: "tenant-a/import-old/invoice.pdf",
    filename: "invoice.pdf",
    mediaType: "application/pdf",
    sizeBytes: FILE_BYTES.byteLength,
    status: "extracted",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type LatestExtractionFixture = {
  id: string;
  documentId: string;
  model: string;
  payload: unknown;
  tokensUsed: number | null;
  createdAt: string;
};

function makeLatestExtraction(
  overrides: Partial<LatestExtractionFixture> &
    Pick<LatestExtractionFixture, "id" | "documentId" | "payload">,
): LatestExtractionFixture {
  return {
    model: "cache-model",
    tokensUsed: 28,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeReuseExtractions(
  invoice: InvoiceExtraction,
  packingList: PackingListExtraction,
  bl: BlExtraction,
) {
  return new Map([
    [
      "old-invoice",
      makeLatestExtraction({
        id: "old-extraction-invoice",
        documentId: "old-invoice",
        model: "invoice-model",
        payload: invoice,
      }),
    ],
    [
      "old-pl",
      makeLatestExtraction({
        id: "old-extraction-pl",
        documentId: "old-pl",
        model: "packing-list-model",
        payload: packingList,
      }),
    ],
    [
      "old-bl",
      makeLatestExtraction({
        id: "old-extraction-bl",
        documentId: "old-bl",
        model: "bl-model",
        payload: bl,
      }),
    ],
  ]);
}

function logEntries(): AiLogEntry[] {
  return mocks.persistAiLog.mock.calls.map((call) => call[0] as AiLogEntry);
}

function logSummary(): string[] {
  return logEntries().map((entry) => `${entry.capability}:${entry.status}`);
}

function persistedDocumentIds(): string[] {
  return mocks.persistExtractionResult.mock.calls.map(
    (call) => (call[0] as { documentId: string }).documentId,
  );
}

function documentStatusUpdates(): Array<{
  documentId: string;
  status: string;
}> {
  return mocks.updateDocumentStatus.mock.calls.map(
    (call) => call[0] as { documentId: string; status: string },
  );
}

function baseParams() {
  return { tenantId: TENANT_ID, userId: USER_ID, file: makeFile() };
}

function attachCalls(): Array<{
  tenantId: string;
  importId: string;
  logIds: string[];
}> {
  return mocks.attachAiLogsToImport.mock.calls.map(
    (call) =>
      call[0] as { tenantId: string; importId: string; logIds: string[] },
  );
}

let aiLogSequence = 0;

function nextAiLogId(): string {
  aiLogSequence += 1;
  return `log-${aiLogSequence}`;
}

function setDefaultMocks() {
  aiLogSequence = 0;
  mocks.getAiOverrides.mockResolvedValue({});
  mocks.getAiModelId.mockReturnValue("model-default");
  mocks.prepareDocument.mockResolvedValue(PREPARED);

  mocks.classifyDocument.mockResolvedValue({
    classification: makeClassification(["invoice"]),
    model: "classify-model",
    tokensIn: 30,
    tokensOut: 12,
    latencyMs: 50,
    usage: { costUsd: 0.01, reasoningTokens: 0 },
  });

  mocks.extractInvoice.mockResolvedValue(
    makeExtractionResult("invoice", makeInvoice(), "invoice-model"),
  );
  mocks.extractPackingList.mockResolvedValue(
    makeExtractionResult("packingList", makePackingList(), "packing-list-model"),
  );
  mocks.extractBl.mockResolvedValue(
    makeExtractionResult("bl", makeBl(), "bl-model"),
  );

  mocks.findOrCreateImport.mockResolvedValue({
    importId: "import-1",
    created: true,
  });
  mocks.findDocumentsBySha256.mockResolvedValue([]);
  mocks.findTenantDocumentsBySha256.mockResolvedValue([]);
  mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(new Map());
  mocks.buildUniqueStoragePath.mockResolvedValue(
    "tenant-a/import-1/invoice.pdf",
  );
  mocks.insertDocuments.mockResolvedValue([
    { id: "doc-invoice", docType: "invoice" },
  ]);
  mocks.persistExtractionResult.mockResolvedValue("extraction-1");

  mocks.persistAiLog.mockImplementation(async () => nextAiLogId());
  mocks.attachAiLogsToImport.mockResolvedValue(undefined);
  mocks.uploadImportFile.mockResolvedValue(undefined);
  mocks.updateDocumentStatus.mockResolvedValue(undefined);
  mocks.fillImportKeysIfEmpty.mockResolvedValue(undefined);
  mocks.clearAutoReferenceIfNeeded.mockResolvedValue(undefined);
  mocks.updateImportStatus.mockResolvedValue(undefined);
  mocks.getImportDetail.mockResolvedValue({});

  mocks.resolveInvoiceParties.mockResolvedValue([]);
  mocks.resolveBlParties.mockResolvedValue([]);
  mocks.pendingPartiesFromInvoice.mockReturnValue([]);
  mocks.pendingPartiesFromBl.mockReturnValue([]);
  mocks.combinePendingParties.mockImplementation(
    (items: PendingParty[]) => items,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  setDefaultMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAnalyzePipeline", () => {
  it("processa uma invoice do início ao fim", async () => {
    const invoice = makeInvoice();
    mocks.extractInvoice.mockResolvedValue(
      makeExtractionResult("invoice", invoice, "invoice-model"),
    );

    const result = await runAnalyzePipeline(baseParams());

    expect(result).toMatchObject({
      importId: "import-1",
      types: ["invoice"],
      documents: [{ id: "doc-invoice", docType: "invoice" }],
      invoice,
      extractionResultId: "extraction-1",
      model: "classify-model",
      deduped: false,
    });
    expect(result.latencyMs).toEqual(expect.any(Number));

    expect(mocks.findTenantDocumentsBySha256).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      sha256: FILE_DIGEST,
    });
    expect(mocks.findOrCreateImport).toHaveBeenCalledTimes(1);
    expect(mocks.findOrCreateImport).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: USER_ID,
      invoiceNumber: "INV-001",
      blNumber: "BL-001",
      supplierName: "Exporter Ltd",
    });

    expect(mocks.buildUniqueStoragePath).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      filename: "invoice.pdf",
      digest: FILE_DIGEST,
    });
    expect(mocks.uploadImportFile).toHaveBeenCalledWith({
      storagePath: "tenant-a/import-1/invoice.pdf",
      bytes: expect.any(Uint8Array),
      mediaType: "application/pdf",
    });
    expect(mocks.insertDocuments).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      types: ["invoice"],
      storagePath: "tenant-a/import-1/invoice.pdf",
      sha256: FILE_DIGEST,
      filename: "invoice.pdf",
      mediaType: "application/pdf",
      sizeBytes: FILE_BYTES.byteLength,
    });

    expect(mocks.persistExtractionResult).toHaveBeenCalledTimes(1);
    expect(mocks.persistExtractionResult).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      documentId: "doc-invoice",
      model: "invoice-model",
      payload: invoice,
      tokensUsed: 28,
    });
    expect(mocks.updateDocumentStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateDocumentStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      documentId: "doc-invoice",
      status: "extracted",
    });
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      status: "awaiting_review",
    });

    expect(logSummary()).toEqual([
      "classify:success",
      "extract_invoice:success",
    ]);
    expect(attachCalls()).toEqual([
      {
        tenantId: TENANT_ID,
        importId: "import-1",
        logIds: ["log-1", "log-2"],
      },
    ]);
    expect(mocks.extractPackingList).not.toHaveBeenCalled();
    expect(mocks.extractBl).not.toHaveBeenCalled();
    expect(mocks.resolveInvoiceParties).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      invoice,
    });
    expect(result.pendingParties).toEqual([]);
  });

  it("prepara o documento uma vez e reutiliza nas tasks", async () => {
    mocks.getAiOverrides.mockResolvedValue({
      provider: "openrouter",
      model: "model-from-settings",
    });
    mocks.classifyDocument.mockResolvedValue({
      classification: makeClassification([
        "invoice",
        "packing_list",
        "bill_of_lading",
      ]),
      model: "classify-model",
      tokensIn: 30,
      tokensOut: 12,
      latencyMs: 50,
      usage: { costUsd: 0.01, reasoningTokens: 0 },
    });
    mocks.insertDocuments.mockResolvedValue([
      { id: "doc-invoice", docType: "invoice" },
      { id: "doc-packing-list", docType: "packing_list" },
      { id: "doc-bl", docType: "bill_of_lading" },
    ]);

    await runAnalyzePipeline(baseParams());

    expect(mocks.prepareDocument).toHaveBeenCalledTimes(1);
    expect(mocks.prepareDocument).toHaveBeenCalledWith(
      {
        bytes: expect.any(Uint8Array),
        mediaType: "application/pdf",
        filename: "invoice.pdf",
      },
      { provider: "openrouter", model: "model-from-settings" },
    );
    expect(mocks.classifyDocument).toHaveBeenCalledWith(PREPARED);
    expect(mocks.extractInvoice).toHaveBeenCalledWith(PREPARED);
    expect(mocks.extractPackingList).toHaveBeenCalledWith(PREPARED);
    expect(mocks.extractBl).toHaveBeenCalledWith(PREPARED);
  });

  it("propaga falha ao preparar o documento no log do classify", async () => {
    const erro = new Error(
      "Não foi possível converter o PDF em imagens (arquivo protegido ou corrompido). Selecione OpenRouter ou envie o documento como PNG/JPG.",
    );
    mocks.prepareDocument.mockRejectedValue(erro);

    await expect(runAnalyzePipeline(baseParams())).rejects.toBe(erro);

    expect(mocks.classifyDocument).not.toHaveBeenCalled();
    expect(logEntries()).toEqual([
      expect.objectContaining({
        capability: "classify",
        status: "error",
        model: "model-default",
        errorMessage: erro.message,
      }),
    ]);
    expect(mocks.findOrCreateImport).not.toHaveBeenCalled();
  });

  it("conclui a análise mesmo quando o vínculo dos logs falha", async () => {
    const invoice = makeInvoice();
    mocks.extractInvoice.mockResolvedValue(
      makeExtractionResult("invoice", invoice, "invoice-model"),
    );
    mocks.attachAiLogsToImport.mockRejectedValue(new Error("update falhou"));

    const result = await runAnalyzePipeline(baseParams());

    expect(result.importId).toBe("import-1");
    expect(result.invoice).toBe(invoice);
    expect(attachCalls()).toEqual([
      {
        tenantId: TENANT_ID,
        importId: "import-1",
        logIds: ["log-1", "log-2"],
      },
    ]);
    expect(console.error).toHaveBeenCalledWith(
      "[analyze-pipeline] falha ao vincular ai_logs à importação:",
      new Error("update falhou"),
    );
  });

  it("vincula apenas os logs que receberam id", async () => {
    mocks.persistAiLog
      .mockResolvedValueOnce("log-1")
      .mockResolvedValueOnce(null);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.importId).toBe("import-1");
    expect(attachCalls()).toEqual([
      {
        tenantId: TENANT_ID,
        importId: "import-1",
        logIds: ["log-1"],
      },
    ]);
  });

  it("processa invoice, packing list e BL no mesmo arquivo", async () => {
    const invoice = makeInvoice();
    const packingList = makePackingList();
    const bl = makeBl();

    mocks.classifyDocument.mockResolvedValue({
      classification: makeClassification([
        "invoice",
        "packing_list",
        "bill_of_lading",
      ]),
      model: "classify-model",
      tokensIn: 30,
      tokensOut: 12,
      latencyMs: 50,
      usage: { costUsd: 0.01, reasoningTokens: 0 },
    });
    mocks.extractInvoice.mockResolvedValue(
      makeExtractionResult("invoice", invoice, "invoice-model"),
    );
    mocks.extractPackingList.mockResolvedValue(
      makeExtractionResult(
        "packingList",
        packingList,
        "packing-list-model",
      ),
    );
    mocks.extractBl.mockResolvedValue(
      makeExtractionResult("bl", bl, "bl-model"),
    );
    mocks.insertDocuments.mockResolvedValue([
      { id: "doc-invoice", docType: "invoice" },
      { id: "doc-packing-list", docType: "packing_list" },
      { id: "doc-bl", docType: "bill_of_lading" },
    ]);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.types).toEqual([
      "invoice",
      "packing_list",
      "bill_of_lading",
    ]);
    expect(result.documents).toEqual([
      { id: "doc-invoice", docType: "invoice" },
      { id: "doc-packing-list", docType: "packing_list" },
      { id: "doc-bl", docType: "bill_of_lading" },
    ]);
    expect(result.invoice).toBe(invoice);
    expect(result.extractionResultId).toBe("extraction-1");
    expect(result.deduped).toBe(false);

    expect(mocks.extractInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.extractPackingList).toHaveBeenCalledTimes(1);
    expect(mocks.extractBl).toHaveBeenCalledTimes(1);

    expect(mocks.persistExtractionResult).toHaveBeenCalledTimes(3);
    expect(mocks.persistExtractionResult).toHaveBeenNthCalledWith(1, {
      tenantId: TENANT_ID,
      documentId: "doc-invoice",
      model: "invoice-model",
      payload: invoice,
      tokensUsed: 28,
    });
    expect(mocks.persistExtractionResult).toHaveBeenNthCalledWith(2, {
      tenantId: TENANT_ID,
      documentId: "doc-packing-list",
      model: "packing-list-model",
      payload: packingList,
      tokensUsed: 28,
    });
    expect(mocks.persistExtractionResult).toHaveBeenNthCalledWith(3, {
      tenantId: TENANT_ID,
      documentId: "doc-bl",
      model: "bl-model",
      payload: bl,
      tokensUsed: 28,
    });

    expect(mocks.updateDocumentStatus).toHaveBeenCalledTimes(3);
    expect(documentStatusUpdates()).toEqual([
      { tenantId: TENANT_ID, documentId: "doc-invoice", status: "extracted" },
      {
        tenantId: TENANT_ID,
        documentId: "doc-packing-list",
        status: "extracted",
      },
      { tenantId: TENANT_ID, documentId: "doc-bl", status: "extracted" },
    ]);
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      status: "awaiting_review",
    });

    expect(logSummary()).toEqual([
      "classify:success",
      "extract_invoice:success",
      "extract_packing_list:success",
      "extract_bl:success",
    ]);
    expect(attachCalls()).toEqual([
      {
        tenantId: TENANT_ID,
        importId: "import-1",
        logIds: ["log-1", "log-2", "log-3", "log-4"],
      },
    ]);
    expect(mocks.resolveInvoiceParties).toHaveBeenCalledTimes(1);
    expect(mocks.resolveBlParties).toHaveBeenCalledTimes(1);
  });

  it("pula storage e persistência quando o documento já existe (dedupe)", async () => {
    mocks.findDocumentsBySha256.mockResolvedValue([
      { id: "existing-doc", docType: "invoice", status: "extracted" },
    ]);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.documents).toEqual([
      { id: "existing-doc", docType: "invoice" },
    ]);
    expect(result.extractionResultId).toBeNull();
    expect(result.deduped).toBe(false);

    expect(mocks.buildUniqueStoragePath).not.toHaveBeenCalled();
    expect(mocks.uploadImportFile).not.toHaveBeenCalled();
    expect(mocks.insertDocuments).not.toHaveBeenCalled();
    expect(mocks.persistExtractionResult).not.toHaveBeenCalled();
    expect(mocks.updateDocumentStatus).not.toHaveBeenCalled();

    expect(mocks.fillImportKeysIfEmpty).toHaveBeenCalledTimes(1);
    expect(mocks.fillImportKeysIfEmpty).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      invoiceNumber: "INV-001",
      blNumber: "BL-001",
      supplierName: "Exporter Ltd",
    });
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      status: "awaiting_review",
    });

    // Fallback de corrida: a IA roda e o dedupe por import evita duplicar
    // storage/persistência quando o documento apareceu durante a análise.
    expect(mocks.classifyDocument).toHaveBeenCalledTimes(1);
    expect(mocks.extractInvoice).toHaveBeenCalledTimes(1);
    expect(logSummary()).toEqual([
      "classify:success",
      "extract_invoice:success",
    ]);
    expect(attachCalls()).toEqual([
      {
        tenantId: TENANT_ID,
        importId: "import-1",
        logIds: ["log-1", "log-2"],
      },
    ]);
  });

  it("reprocessa documento existente que ficou failed", async () => {
    mocks.findDocumentsBySha256.mockResolvedValue([
      { id: "existing-doc", docType: "invoice", status: "failed" },
    ]);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.extractionResultId).toBe("extraction-1");
    expect(result.documents).toEqual([
      { id: "existing-doc", docType: "invoice" },
    ]);
    expect(mocks.uploadImportFile).not.toHaveBeenCalled();
    expect(mocks.insertDocuments).not.toHaveBeenCalled();
    expect(mocks.persistExtractionResult).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "existing-doc" }),
    );
    expect(mocks.updateDocumentStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      documentId: "existing-doc",
      status: "extracted",
    });
    expect(mocks.fillImportKeysIfEmpty).not.toHaveBeenCalled();
  });

  it("reaproveita upload completo de outra importação sem chamar IA", async () => {
    const invoice = makeInvoice();
    const packingList = makePackingList();
    const bl = makeBl();
    const invoicePending: PendingParty[] = [
      {
        roles: ["consignee"],
        name: "Importador",
        cnpj: null,
        address: emptyAddress(),
      },
    ];
    const blPending: PendingParty[] = [
      {
        roles: ["notify"],
        name: "Notify",
        cnpj: null,
        address: emptyAddress(),
      },
    ];

    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({ id: "old-invoice", docType: "invoice" }),
      makeTenantDoc({ id: "old-pl", docType: "packing_list" }),
      makeTenantDoc({ id: "old-bl", docType: "bill_of_lading" }),
    ]);
    mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(
      makeReuseExtractions(invoice, packingList, bl),
    );
    mocks.resolveInvoiceParties.mockResolvedValue(invoicePending);
    mocks.resolveBlParties.mockResolvedValue(blPending);

    const result = await runAnalyzePipeline(baseParams());

    expect(result).toMatchObject({
      importId: "import-old",
      types: ["invoice", "packing_list", "bill_of_lading"],
      documents: [
        { id: "old-invoice", docType: "invoice" },
        { id: "old-pl", docType: "packing_list" },
        { id: "old-bl", docType: "bill_of_lading" },
      ],
      invoice,
      extractionResultId: "old-extraction-invoice",
      pendingParties: [...invoicePending, ...blPending],
      model: "invoice-model",
      deduped: true,
    });
    expect(result.latencyMs).toEqual(expect.any(Number));

    expect(mocks.findTenantDocumentsBySha256).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      sha256: FILE_DIGEST,
    });
    expect(mocks.findLatestExtractionsByDocumentIds).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      documentIds: ["old-invoice", "old-pl", "old-bl"],
    });

    expect(mocks.getAiOverrides).not.toHaveBeenCalled();
    expect(mocks.getAiModelId).not.toHaveBeenCalled();
    expect(mocks.classifyDocument).not.toHaveBeenCalled();
    expect(mocks.extractInvoice).not.toHaveBeenCalled();
    expect(mocks.extractPackingList).not.toHaveBeenCalled();
    expect(mocks.extractBl).not.toHaveBeenCalled();
    expect(mocks.persistAiLog).not.toHaveBeenCalled();
    expect(mocks.attachAiLogsToImport).not.toHaveBeenCalled();
    expect(mocks.findOrCreateImport).not.toHaveBeenCalled();
    expect(mocks.getImportDetail).not.toHaveBeenCalled();
    expect(mocks.buildUniqueStoragePath).not.toHaveBeenCalled();
    expect(mocks.uploadImportFile).not.toHaveBeenCalled();
    expect(mocks.insertDocuments).not.toHaveBeenCalled();
    expect(mocks.persistExtractionResult).not.toHaveBeenCalled();
    expect(mocks.updateDocumentStatus).not.toHaveBeenCalled();
    expect(mocks.updateImportStatus).not.toHaveBeenCalled();

    expect(mocks.resolveInvoiceParties).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-old",
      invoice,
    });
    expect(mocks.resolveBlParties).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-old",
      bl,
    });
  });

  it("reaproveita documentos quando o upload já pertence à importação informada", async () => {
    const invoice = makeInvoice();

    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({
        id: "old-invoice",
        docType: "invoice",
        importId: "import-existing",
      }),
    ]);
    mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(
      new Map([
        [
          "old-invoice",
          makeLatestExtraction({
            id: "old-extraction-invoice",
            documentId: "old-invoice",
            model: "invoice-model",
            payload: invoice,
          }),
        ],
      ]),
    );

    const result = await runAnalyzePipeline({
      ...baseParams(),
      importId: "import-existing",
    });

    expect(result).toMatchObject({
      importId: "import-existing",
      types: ["invoice"],
      documents: [{ id: "old-invoice", docType: "invoice" }],
      invoice,
      extractionResultId: "old-extraction-invoice",
      model: "invoice-model",
      deduped: true,
    });

    expect(mocks.getImportDetail).toHaveBeenCalledWith(
      TENANT_ID,
      "import-existing",
    );
    expect(mocks.buildUniqueStoragePath).not.toHaveBeenCalled();
    expect(mocks.uploadImportFile).not.toHaveBeenCalled();
    expect(mocks.insertDocuments).not.toHaveBeenCalled();
    expect(mocks.persistExtractionResult).not.toHaveBeenCalled();
    expect(mocks.updateDocumentStatus).not.toHaveBeenCalled();
    expect(mocks.updateImportStatus).not.toHaveBeenCalled();
    expect(mocks.findDocumentsBySha256).not.toHaveBeenCalled();
    expect(mocks.classifyDocument).not.toHaveBeenCalled();
    expect(mocks.extractInvoice).not.toHaveBeenCalled();
    expect(mocks.attachAiLogsToImport).not.toHaveBeenCalled();

    expect(mocks.resolveInvoiceParties).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-existing",
      invoice,
    });
    expect(mocks.resolveBlParties).not.toHaveBeenCalled();
  });

  it("copia documentos e extrações para outro import sem chamar IA", async () => {
    const invoice = makeInvoice();
    const packingList = makePackingList();
    const bl = makeBl();
    const newDocs = [
      { id: "new-invoice", docType: "invoice" as DocumentType },
      { id: "new-pl", docType: "packing_list" as DocumentType },
      { id: "new-bl", docType: "bill_of_lading" as DocumentType },
    ];

    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({ id: "old-invoice", docType: "invoice" }),
      makeTenantDoc({ id: "old-pl", docType: "packing_list" }),
      makeTenantDoc({ id: "old-bl", docType: "bill_of_lading" }),
    ]);
    mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(
      makeReuseExtractions(invoice, packingList, bl),
    );
    mocks.buildUniqueStoragePath.mockResolvedValue(
      "tenant-a/import-new/invoice.pdf",
    );
    mocks.insertDocuments.mockResolvedValue(newDocs);
    mocks.persistExtractionResult
      .mockResolvedValueOnce("new-extraction-invoice")
      .mockResolvedValueOnce("new-extraction-pl")
      .mockResolvedValueOnce("new-extraction-bl");

    const result = await runAnalyzePipeline({
      ...baseParams(),
      importId: "import-new",
    });

    expect(result).toMatchObject({
      importId: "import-new",
      types: ["invoice", "packing_list", "bill_of_lading"],
      documents: newDocs,
      invoice,
      extractionResultId: "new-extraction-invoice",
      model: "invoice-model",
      deduped: true,
    });

    expect(mocks.getImportDetail).toHaveBeenCalledWith(TENANT_ID, "import-new");
    expect(mocks.buildUniqueStoragePath).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-new",
      filename: "invoice.pdf",
      digest: FILE_DIGEST,
    });
    expect(mocks.uploadImportFile).toHaveBeenCalledWith({
      storagePath: "tenant-a/import-new/invoice.pdf",
      bytes: expect.any(Uint8Array),
      mediaType: "application/pdf",
    });
    expect(mocks.insertDocuments).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-new",
      types: ["invoice", "packing_list", "bill_of_lading"],
      storagePath: "tenant-a/import-new/invoice.pdf",
      sha256: FILE_DIGEST,
      filename: "invoice.pdf",
      mediaType: "application/pdf",
      sizeBytes: FILE_BYTES.byteLength,
    });

    expect(mocks.persistExtractionResult).toHaveBeenNthCalledWith(1, {
      tenantId: TENANT_ID,
      documentId: "new-invoice",
      model: "invoice-model",
      payload: invoice,
      tokensUsed: 28,
    });
    expect(mocks.persistExtractionResult).toHaveBeenNthCalledWith(2, {
      tenantId: TENANT_ID,
      documentId: "new-pl",
      model: "packing-list-model",
      payload: packingList,
      tokensUsed: 28,
    });
    expect(mocks.persistExtractionResult).toHaveBeenNthCalledWith(3, {
      tenantId: TENANT_ID,
      documentId: "new-bl",
      model: "bl-model",
      payload: bl,
      tokensUsed: 28,
    });

    expect(documentStatusUpdates()).toEqual([
      { tenantId: TENANT_ID, documentId: "new-invoice", status: "extracted" },
      { tenantId: TENANT_ID, documentId: "new-pl", status: "extracted" },
      { tenantId: TENANT_ID, documentId: "new-bl", status: "extracted" },
    ]);
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-new",
      status: "awaiting_review",
    });
    expect(mocks.fillImportKeysIfEmpty).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-new",
      invoiceNumber: "INV-001",
      blNumber: "BL-001",
      supplierName: "Exporter Ltd",
    });
    expect(mocks.clearAutoReferenceIfNeeded).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-new",
    });

    expect(mocks.classifyDocument).not.toHaveBeenCalled();
    expect(mocks.extractInvoice).not.toHaveBeenCalled();
    expect(mocks.extractPackingList).not.toHaveBeenCalled();
    expect(mocks.extractBl).not.toHaveBeenCalled();
    expect(mocks.attachAiLogsToImport).not.toHaveBeenCalled();
    expect(mocks.findOrCreateImport).not.toHaveBeenCalled();
    expect(mocks.findDocumentsBySha256).not.toHaveBeenCalled();
  });

  it("usa fallback de partes no reuso quando a resolução falha", async () => {
    const invoice = makeInvoice();
    const bl = makeBl();
    const invoicePending: PendingParty[] = [
      {
        roles: ["consignee"],
        name: "Importador",
        cnpj: null,
        address: emptyAddress(),
      },
    ];
    const blPending: PendingParty[] = [
      {
        roles: ["notify"],
        name: "Notify",
        cnpj: null,
        address: emptyAddress(),
      },
    ];

    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({ id: "old-invoice", docType: "invoice" }),
      makeTenantDoc({ id: "old-bl", docType: "bill_of_lading" }),
    ]);
    mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(
      new Map([
        [
          "old-invoice",
          makeLatestExtraction({
            id: "old-extraction-invoice",
            documentId: "old-invoice",
            model: "invoice-model",
            payload: invoice,
          }),
        ],
        [
          "old-bl",
          makeLatestExtraction({
            id: "old-extraction-bl",
            documentId: "old-bl",
            model: "bl-model",
            payload: bl,
          }),
        ],
      ]),
    );
    mocks.resolveInvoiceParties.mockRejectedValue(new Error("party falhou"));
    mocks.resolveBlParties.mockRejectedValue(new Error("bl party falhou"));
    mocks.pendingPartiesFromInvoice.mockReturnValue(invoicePending);
    mocks.pendingPartiesFromBl.mockReturnValue(blPending);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.pendingParties).toEqual([...invoicePending, ...blPending]);
    expect(result.deduped).toBe(true);
    expect(mocks.pendingPartiesFromInvoice).toHaveBeenCalledWith(invoice);
    expect(mocks.pendingPartiesFromBl).toHaveBeenCalledWith(bl);
    expect(mocks.combinePendingParties).toHaveBeenCalledWith([
      ...invoicePending,
      ...blPending,
    ]);
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(mocks.classifyDocument).not.toHaveBeenCalled();
  });

  it("segue para a IA quando falta extração de algum documento do upload", async () => {
    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({ id: "old-invoice", docType: "invoice" }),
    ]);
    mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(new Map());

    const result = await runAnalyzePipeline(baseParams());

    expect(result.deduped).toBe(false);
    expect(result.importId).toBe("import-1");
    expect(mocks.classifyDocument).toHaveBeenCalledTimes(1);
    expect(mocks.extractInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.findOrCreateImport).toHaveBeenCalledTimes(1);
  });

  it("segue para a IA quando o documento reutilizável não está extraído", async () => {
    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({
        id: "old-invoice",
        docType: "invoice",
        status: "pending",
      }),
    ]);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.deduped).toBe(false);
    expect(result.importId).toBe("import-1");
    expect(mocks.findLatestExtractionsByDocumentIds).not.toHaveBeenCalled();
    expect(mocks.classifyDocument).toHaveBeenCalledTimes(1);
    expect(mocks.findOrCreateImport).toHaveBeenCalledTimes(1);
  });

  it("reaproveita upload anterior completo quando o mais recente está incompleto", async () => {
    const invoice = makeInvoice();

    mocks.findTenantDocumentsBySha256.mockResolvedValue([
      makeTenantDoc({
        id: "new-invoice",
        docType: "invoice",
        importId: "import-new",
        storagePath: "tenant-a/import-new/invoice.pdf",
        status: "pending",
      }),
      makeTenantDoc({
        id: "old-invoice",
        docType: "invoice",
        importId: "import-old",
        storagePath: "tenant-a/import-old/invoice.pdf",
      }),
    ]);
    mocks.findLatestExtractionsByDocumentIds.mockResolvedValue(
      new Map([
        [
          "old-invoice",
          makeLatestExtraction({
            id: "old-extraction-invoice",
            documentId: "old-invoice",
            model: "invoice-model",
            payload: invoice,
          }),
        ],
      ]),
    );

    const result = await runAnalyzePipeline(baseParams());

    expect(result.deduped).toBe(true);
    expect(result.importId).toBe("import-old");
    expect(result.invoice).toEqual(invoice);
    expect(mocks.findLatestExtractionsByDocumentIds).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      documentIds: ["old-invoice"],
    });
    expect(mocks.classifyDocument).not.toHaveBeenCalled();
    expect(mocks.extractInvoice).not.toHaveBeenCalled();
    expect(mocks.attachAiLogsToImport).not.toHaveBeenCalled();
  });

  it("reaproveita a importação informada e não cria outra", async () => {
    const result = await runAnalyzePipeline({
      ...baseParams(),
      importId: "import-existing",
    });

    expect(result.importId).toBe("import-existing");
    expect(result.deduped).toBe(false);
    expect(mocks.findOrCreateImport).not.toHaveBeenCalled();
    expect(mocks.getImportDetail).toHaveBeenCalledWith(
      TENANT_ID,
      "import-existing",
    );
    expect(mocks.fillImportKeysIfEmpty).toHaveBeenCalledTimes(1);
    expect(mocks.fillImportKeysIfEmpty).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-existing",
      invoiceNumber: "INV-001",
      blNumber: "BL-001",
      supplierName: "Exporter Ltd",
    });
    expect(mocks.clearAutoReferenceIfNeeded).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-existing",
    });
    expect(mocks.findDocumentsBySha256).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-existing",
      sha256: FILE_DIGEST,
    });
    expect(mocks.uploadImportFile).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "tenant-a/import-1/invoice.pdf",
      }),
    );
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-existing",
      status: "awaiting_review",
    });
  });

  it("propaga falha da classificação e registra log de erro", async () => {
    mocks.classifyDocument.mockRejectedValue(new Error("classify falhou"));

    await expect(runAnalyzePipeline(baseParams())).rejects.toThrow(
      "classify falhou",
    );

    const logs = logEntries();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tenantId: TENANT_ID,
      capability: "classify",
      model: "model-default",
      tokensIn: 0,
      tokensOut: 0,
      status: "error",
      errorMessage: "classify falhou",
    });

    expect(mocks.extractInvoice).not.toHaveBeenCalled();
    expect(mocks.extractPackingList).not.toHaveBeenCalled();
    expect(mocks.extractBl).not.toHaveBeenCalled();
    expect(mocks.attachAiLogsToImport).not.toHaveBeenCalled();
    expect(mocks.findOrCreateImport).not.toHaveBeenCalled();
    expect(mocks.buildUniqueStoragePath).not.toHaveBeenCalled();
    expect(mocks.uploadImportFile).not.toHaveBeenCalled();
    expect(mocks.insertDocuments).not.toHaveBeenCalled();
    expect(mocks.persistExtractionResult).not.toHaveBeenCalled();
    expect(mocks.updateImportStatus).not.toHaveBeenCalled();
  });

  it("falha do packing list não é fatal e não persiste o PL", async () => {
    const invoice = makeInvoice();
    mocks.classifyDocument.mockResolvedValue({
      classification: makeClassification(["invoice", "packing_list"]),
      model: "classify-model",
      tokensIn: 30,
      tokensOut: 12,
      latencyMs: 50,
      usage: { costUsd: 0.01, reasoningTokens: 0 },
    });
    mocks.extractInvoice.mockResolvedValue(
      makeExtractionResult("invoice", invoice, "invoice-model"),
    );
    mocks.extractPackingList.mockRejectedValue(new Error("packing falhou"));
    mocks.insertDocuments.mockResolvedValue([
      { id: "doc-invoice", docType: "invoice" },
      { id: "doc-packing-list", docType: "packing_list" },
    ]);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.invoice).toBe(invoice);
    expect(result.documents).toEqual([
      { id: "doc-invoice", docType: "invoice" },
      { id: "doc-packing-list", docType: "packing_list" },
    ]);
    expect(result.deduped).toBe(false);
    expect(persistedDocumentIds()).toEqual(["doc-invoice"]);
    expect(mocks.persistExtractionResult).toHaveBeenCalledTimes(1);
    expect(mocks.persistExtractionResult).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      documentId: "doc-invoice",
      model: "invoice-model",
      payload: invoice,
      tokensUsed: 28,
    });
    expect(documentStatusUpdates()).toEqual([
      { tenantId: TENANT_ID, documentId: "doc-invoice", status: "extracted" },
    ]);
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      status: "awaiting_review",
    });

    expect(logSummary()).toEqual([
      "classify:success",
      "extract_invoice:success",
      "extract_packing_list:error",
    ]);
    expect(logEntries()[2]).toMatchObject({
      capability: "extract_packing_list",
      status: "error",
      model: "model-default",
      errorMessage: "packing falhou",
    });
    expect(attachCalls()).toEqual([
      {
        tenantId: TENANT_ID,
        importId: "import-1",
        logIds: ["log-1", "log-2", "log-3"],
      },
    ]);
  });

  it("falha do BL sem invoice é fatal", async () => {
    mocks.classifyDocument.mockResolvedValue({
      classification: makeClassification(["bill_of_lading"]),
      model: "classify-model",
      tokensIn: 30,
      tokensOut: 12,
      latencyMs: 50,
      usage: { costUsd: 0.01, reasoningTokens: 0 },
    });
    mocks.extractBl.mockRejectedValue(new Error("bl falhou"));

    await expect(runAnalyzePipeline(baseParams())).rejects.toThrow(
      "bl falhou",
    );

    const logs = logEntries();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      capability: "classify",
      status: "success",
    });
    expect(logs[1]).toMatchObject({
      capability: "extract_bl",
      status: "error",
      model: "model-default",
      errorMessage: "bl falhou",
    });

    expect(mocks.extractInvoice).not.toHaveBeenCalled();
    expect(mocks.extractPackingList).not.toHaveBeenCalled();
    expect(mocks.attachAiLogsToImport).not.toHaveBeenCalled();
    expect(mocks.findOrCreateImport).not.toHaveBeenCalled();
    expect(mocks.uploadImportFile).not.toHaveBeenCalled();
    expect(mocks.insertDocuments).not.toHaveBeenCalled();
    expect(mocks.updateImportStatus).not.toHaveBeenCalled();
  });

  it("usa fallback de partes quando resolveInvoiceParties falha", async () => {
    const invoice = makeInvoice();
    const sentinel: PendingParty[] = [
      {
        roles: ["consignee"],
        name: "Pendente",
        cnpj: null,
        address: emptyAddress(),
      },
    ];

    mocks.extractInvoice.mockResolvedValue(
      makeExtractionResult("invoice", invoice, "invoice-model"),
    );
    mocks.resolveInvoiceParties.mockRejectedValue(new Error("party falhou"));
    mocks.pendingPartiesFromInvoice.mockReturnValue(sentinel);

    const result = await runAnalyzePipeline(baseParams());

    expect(result.invoice).toBe(invoice);
    expect(result.pendingParties).toBe(sentinel);
    expect(result.deduped).toBe(false);
    expect(mocks.resolveInvoiceParties).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      invoice,
    });
    expect(mocks.pendingPartiesFromInvoice).toHaveBeenCalledWith(invoice);
    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      status: "awaiting_review",
    });
    expect(mocks.persistExtractionResult).toHaveBeenCalledTimes(1);
    expect(logSummary()).toEqual([
      "classify:success",
      "extract_invoice:success",
    ]);
  });
});

describe("falha no pipeline", () => {
  it("marca a importação como failed antes de propagar o erro", async () => {
    mocks.insertDocuments.mockRejectedValue(
      new Error("falha ao registrar documentos"),
    );

    await expect(runAnalyzePipeline(baseParams())).rejects.toThrow(
      "falha ao registrar documentos",
    );

    expect(mocks.updateImportStatus).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      importId: "import-1",
      status: "failed",
    });
  });

  it("não marca status quando a falha acontece antes de resolver a importação", async () => {
    mocks.findTenantDocumentsBySha256.mockRejectedValue(
      new Error("banco indisponível"),
    );

    await expect(runAnalyzePipeline(baseParams())).rejects.toThrow(
      "banco indisponível",
    );

    expect(mocks.updateImportStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("propaga o erro original mesmo se o update de status falhar", async () => {
    mocks.insertDocuments.mockRejectedValue(
      new Error("falha ao registrar documentos"),
    );
    mocks.updateImportStatus.mockRejectedValue(new Error("status falhou"));

    await expect(runAnalyzePipeline(baseParams())).rejects.toThrow(
      "falha ao registrar documentos",
    );
  });
});
