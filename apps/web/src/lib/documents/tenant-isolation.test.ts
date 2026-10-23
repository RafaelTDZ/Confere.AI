import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findDocumentsBySha256,
  insertDocuments,
  listImportStoragePaths,
  moveDocumentsToImport,
  updateDocumentStatus,
} from "@/lib/documents/documents";
import { persistExtractionResult } from "@/lib/documents/extractions";
import {
  fillImportKeysIfEmpty,
  updateImportStatus,
} from "@/lib/documents/imports";
import { assertDocumentOwnership } from "@/lib/documents/ownership";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

function importSeed(params: { tenantId: string; status?: string }): FakeRow {
  return {
    id: "import-shared",
    tenant_id: params.tenantId,
    reference_number: null,
    status: params.status ?? "processing",
    supplier_name: null,
    invoice_number: null,
    bl_number: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function documentSeed(params: {
  id: string;
  tenantId: string;
  importId: string;
  docType: string;
  storagePath: string;
  sha256: string;
  version: number;
  status?: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    import_id: params.importId,
    doc_type: params.docType,
    storage_path: params.storagePath,
    sha256: params.sha256,
    version: params.version,
    status: params.status ?? "pending",
    original_filename: `${params.id}.pdf`,
    content_type: "application/pdf",
    size_bytes: 1000,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function seedAdmin(): FakeSupabase {
  return new FakeSupabase({
    imports: [
      importSeed({ tenantId: "tenant-a" }),
      importSeed({ tenantId: "tenant-b" }),
      {
        ...importSeed({ tenantId: "tenant-b" }),
        id: "import-b-only",
      },
    ],
    documents: [
      documentSeed({
        id: "doc-a-invoice",
        tenantId: "tenant-a",
        importId: "import-shared",
        docType: "invoice",
        storagePath: "tenant-a/invoice.pdf",
        sha256: "sha-same",
        version: 1,
      }),
      documentSeed({
        id: "doc-a-bl",
        tenantId: "tenant-a",
        importId: "import-shared",
        docType: "bill_of_lading",
        storagePath: "tenant-a/bl.pdf",
        sha256: "sha-bl",
        version: 1,
      }),
      documentSeed({
        id: "doc-b-invoice",
        tenantId: "tenant-b",
        importId: "import-shared",
        docType: "invoice",
        storagePath: "tenant-b/invoice.pdf",
        sha256: "sha-same",
        version: 5,
      }),
      documentSeed({
        id: "doc-b-insert",
        tenantId: "tenant-b",
        importId: "import-insert",
        docType: "invoice",
        storagePath: "tenant-b/insert.pdf",
        sha256: "sha-insert",
        version: 5,
      }),
      documentSeed({
        id: "doc-a-source",
        tenantId: "tenant-a",
        importId: "import-source",
        docType: "invoice",
        storagePath: "tenant-a/source.pdf",
        sha256: "sha-source-a",
        version: 1,
      }),
      documentSeed({
        id: "doc-b-source",
        tenantId: "tenant-b",
        importId: "import-source",
        docType: "invoice",
        storagePath: "tenant-b/source.pdf",
        sha256: "sha-source-b",
        version: 5,
      }),
      documentSeed({
        id: "doc-a-target",
        tenantId: "tenant-a",
        importId: "import-target",
        docType: "invoice",
        storagePath: "tenant-a/target.pdf",
        sha256: "sha-target-a",
        version: 2,
      }),
      documentSeed({
        id: "doc-b-target",
        tenantId: "tenant-b",
        importId: "import-target",
        docType: "invoice",
        storagePath: "tenant-b/target.pdf",
        sha256: "sha-target-b",
        version: 10,
      }),
    ],
    extraction_results: [],
  });
}

let admin: FakeSupabase;

beforeEach(() => {
  admin = seedAdmin();
  mocks.admin = admin;
});

function findRow(table: string, id: string): FakeRow {
  const row = admin.rows(table).find((candidate) => candidate.id === id);
  if (!row) {
    throw new Error(`Linha ${table}/${id} não encontrada`);
  }
  return row;
}

function findImport(id: string, tenantId: string): FakeRow {
  const row = admin
    .rows("imports")
    .find(
      (candidate) => candidate.id === id && candidate.tenant_id === tenantId,
    );
  if (!row) {
    throw new Error(`Importação ${id} do tenant ${tenantId} não encontrada`);
  }
  return row;
}

describe("findDocumentsBySha256", () => {
  it("retorna somente o documento do tenant informado", async () => {
    const documents = await findDocumentsBySha256({
      tenantId: "tenant-a",
      importId: "import-shared",
      sha256: "sha-same",
    });

    expect(documents).toEqual([{ id: "doc-a-invoice", docType: "invoice" }]);
  });

  it("retorna lista vazia quando o tenant não possui o documento", async () => {
    const documents = await findDocumentsBySha256({
      tenantId: "tenant-c",
      importId: "import-shared",
      sha256: "sha-same",
    });

    expect(documents).toEqual([]);
  });
});

describe("updateDocumentStatus", () => {
  it("atualiza o documento do próprio tenant", async () => {
    await updateDocumentStatus({
      tenantId: "tenant-a",
      documentId: "doc-a-invoice",
      status: "extracted",
    });

    expect(findRow("documents", "doc-a-invoice").status).toBe("extracted");
    expect(findRow("documents", "doc-b-invoice").status).toBe("pending");
  });

  it("não altera o documento de outro tenant", async () => {
    await updateDocumentStatus({
      tenantId: "tenant-a",
      documentId: "doc-b-invoice",
      status: "failed",
    });

    expect(findRow("documents", "doc-b-invoice").status).toBe("pending");
  });
});

describe("listImportStoragePaths", () => {
  it("retorna somente os paths do tenant informado", async () => {
    const paths = await listImportStoragePaths({
      tenantId: "tenant-a",
      importId: "import-shared",
    });

    expect(paths.sort()).toEqual(["tenant-a/bl.pdf", "tenant-a/invoice.pdf"]);
    expect(paths).not.toContain("tenant-b/invoice.pdf");
  });
});

describe("assertDocumentOwnership", () => {
  it("resolve para um documento do próprio tenant", async () => {
    await expect(
      assertDocumentOwnership({
        tenantId: "tenant-a",
        documentId: "doc-a-invoice",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejeita documento de outro tenant", async () => {
    await expect(
      assertDocumentOwnership({
        tenantId: "tenant-a",
        documentId: "doc-b-invoice",
      }),
    ).rejects.toThrow("Documento não pertence ao tenant");
  });
});

describe("persistExtractionResult", () => {
  it("rejeita extração cross-tenant antes de inserir", async () => {
    await expect(
      persistExtractionResult({
        tenantId: "tenant-a",
        documentId: "doc-b-invoice",
        model: "modelo-teste",
        payload: { invoice_number: "INV-B" },
      }),
    ).rejects.toThrow("Documento não pertence ao tenant");

    expect(admin.rows("extraction_results")).toHaveLength(0);
  });

  it("grava a extração com tenant e documento corretos", async () => {
    const id = await persistExtractionResult({
      tenantId: "tenant-a",
      documentId: "doc-a-invoice",
      model: "modelo-teste",
      payload: { invoice_number: "INV-A" },
      tokensUsed: 42,
    });

    expect(typeof id).toBe("string");
    const rows = admin.rows("extraction_results");
    expect(rows).toHaveLength(1);
    const extraction = rows[0];
    if (!extraction) {
      throw new Error("Extração não foi gravada");
    }
    expect(extraction).toMatchObject({
      id,
      tenant_id: "tenant-a",
      document_id: "doc-a-invoice",
      model: "modelo-teste",
      tokens_used: 42,
    });
    expect(extraction.payload).toEqual({ invoice_number: "INV-A" });
  });
});

describe("fillImportKeysIfEmpty", () => {
  it("preenche somente a importação do próprio tenant", async () => {
    await fillImportKeysIfEmpty({
      tenantId: "tenant-a",
      importId: "import-shared",
      invoiceNumber: "INV-A",
      blNumber: "BL-A",
      supplierName: "Fornecedor A",
    });

    expect(findImport("import-shared", "tenant-a")).toMatchObject({
      invoice_number: "INV-A",
      bl_number: "BL-A",
      supplier_name: "Fornecedor A",
    });
    expect(findImport("import-shared", "tenant-b")).toMatchObject({
      invoice_number: null,
      bl_number: null,
      supplier_name: null,
    });
  });

  it("não altera importação de outro tenant", async () => {
    await fillImportKeysIfEmpty({
      tenantId: "tenant-a",
      importId: "import-b-only",
      invoiceNumber: "INV-X",
      blNumber: "BL-X",
      supplierName: "Fornecedor X",
    });

    expect(findImport("import-b-only", "tenant-b")).toMatchObject({
      invoice_number: null,
      bl_number: null,
      supplier_name: null,
    });
  });
});

describe("updateImportStatus", () => {
  it("atualiza somente a importação do próprio tenant", async () => {
    await updateImportStatus({
      tenantId: "tenant-a",
      importId: "import-shared",
      status: "awaiting_review",
    });

    expect(findImport("import-shared", "tenant-a").status).toBe(
      "awaiting_review",
    );
    expect(findImport("import-shared", "tenant-b").status).toBe("processing");
  });

  it("não altera importação de outro tenant", async () => {
    await updateImportStatus({
      tenantId: "tenant-a",
      importId: "import-b-only",
      status: "awaiting_review",
    });

    expect(findImport("import-b-only", "tenant-b").status).toBe("processing");
  });
});

describe("insertDocuments", () => {
  it("versiona ignorando documentos de outro tenant e grava tenant_id correto", async () => {
    const inserted = await insertDocuments({
      tenantId: "tenant-a",
      importId: "import-insert",
      types: ["invoice"],
      storagePath: "tenant-a/novo.pdf",
      sha256: "sha-novo",
      filename: "novo.pdf",
      mediaType: "application/pdf",
      sizeBytes: 321,
    });

    expect(inserted).toHaveLength(1);
    const [insertedDocument] = inserted;
    if (!insertedDocument) {
      throw new Error("Documento não foi inserido");
    }
    expect(insertedDocument.docType).toBe("invoice");

    const tenantDocuments = admin
      .rows("documents")
      .filter(
        (row) =>
          row.tenant_id === "tenant-a" && row.import_id === "import-insert",
      );
    expect(tenantDocuments).toHaveLength(1);
    const [tenantDocument] = tenantDocuments;
    if (!tenantDocument) {
      throw new Error("Documento do tenant não foi encontrado");
    }
    expect(tenantDocument).toMatchObject({
      id: insertedDocument.id,
      tenant_id: "tenant-a",
      import_id: "import-insert",
      doc_type: "invoice",
      version: 1,
      storage_path: "tenant-a/novo.pdf",
      sha256: "sha-novo",
      status: "pending",
    });
    expect(findRow("documents", "doc-b-insert").version).toBe(5);
  });
});

describe("moveDocumentsToImport", () => {
  it("move só documentos do próprio tenant e ignora versões de outro tenant", async () => {
    await moveDocumentsToImport({
      tenantId: "tenant-a",
      sourceImportId: "import-source",
      targetImportId: "import-target",
    });

    expect(findRow("documents", "doc-a-source")).toMatchObject({
      import_id: "import-target",
      version: 3,
    });
    expect(findRow("documents", "doc-b-source")).toMatchObject({
      import_id: "import-source",
      version: 5,
    });
    expect(findRow("documents", "doc-b-target")).toMatchObject({
      import_id: "import-target",
      version: 10,
    });
  });
});
