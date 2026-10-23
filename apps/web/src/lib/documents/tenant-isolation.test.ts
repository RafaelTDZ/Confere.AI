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

const mocks = vi.hoisted(() => ({
  adminClient: undefined as unknown,
  readClient: undefined as unknown,
  failAdminClient: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (mocks.failAdminClient) {
      throw new Error("admin não deveria ser usado");
    }
    return mocks.adminClient;
  },
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.readClient,
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
let adminClient: FakeSupabase;
let readClient: FakeSupabase;

beforeEach(() => {
  admin = seedAdmin();
  adminClient = admin;
  readClient = admin;
  mocks.adminClient = adminClient;
  mocks.readClient = readClient;
  mocks.failAdminClient = false;
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

/** Delega ao fake e injeta erro somente na segunda consulta (destino). */
function readClientWithSecondSelectFailure(message: string): unknown {
  const db = seedAdmin();
  const originalFrom = db.from.bind(db);
  let calls = 0;
  return {
    from(table: string) {
      calls += 1;
      if (calls === 2) {
        db.failNext({ message }, { table, operation: "select" });
      }
      return originalFrom(table);
    },
  };
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

  it("propaga erro do banco ao ler", async () => {
    readClient.failNext(
      { message: "falha ao buscar documentos" },
      { table: "documents", operation: "select" },
    );

    await expect(
      findDocumentsBySha256({
        tenantId: "tenant-a",
        importId: "import-shared",
        sha256: "sha-same",
      }),
    ).rejects.toThrow("falha ao buscar documentos");
  });

  it("lê documentos sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    const documents = await findDocumentsBySha256({
      tenantId: "tenant-a",
      importId: "import-shared",
      sha256: "sha-same",
    });

    expect(documents).toEqual([{ id: "doc-a-invoice", docType: "invoice" }]);
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

  it("propaga erro do banco ao escrever", async () => {
    adminClient.failNext(
      { message: "falha ao atualizar documento" },
      { table: "documents", operation: "update" },
    );

    await expect(
      updateDocumentStatus({
        tenantId: "tenant-a",
        documentId: "doc-a-invoice",
        status: "extracted",
      }),
    ).rejects.toThrow("falha ao atualizar documento");
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

  it("propaga erro do banco ao listar", async () => {
    readClient.failNext(
      { message: "falha ao listar arquivos" },
      { table: "documents", operation: "select" },
    );

    await expect(
      listImportStoragePaths({
        tenantId: "tenant-a",
        importId: "import-shared",
      }),
    ).rejects.toThrow("falha ao listar arquivos");
  });

  it("lista paths sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    const paths = await listImportStoragePaths({
      tenantId: "tenant-a",
      importId: "import-shared",
    });

    expect(paths.sort()).toEqual(["tenant-a/bl.pdf", "tenant-a/invoice.pdf"]);
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

  it("propaga erro do banco ao validar", async () => {
    readClient.failNext(
      { message: "falha ao validar documento" },
      { table: "documents", operation: "select" },
    );

    await expect(
      assertDocumentOwnership({
        tenantId: "tenant-a",
        documentId: "doc-a-invoice",
      }),
    ).rejects.toThrow("falha ao validar documento");
  });

  it("valida a posse sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    await expect(
      assertDocumentOwnership({
        tenantId: "tenant-a",
        documentId: "doc-a-invoice",
      }),
    ).resolves.toBeUndefined();
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

  it("propaga erro do banco ao validar a posse", async () => {
    readClient.failNext(
      { message: "falha ao validar posse" },
      { table: "documents", operation: "select" },
    );

    await expect(
      persistExtractionResult({
        tenantId: "tenant-a",
        documentId: "doc-a-invoice",
        model: "modelo-teste",
        payload: {},
      }),
    ).rejects.toThrow("falha ao validar posse");
  });

  it("propaga erro do banco ao inserir a extração", async () => {
    adminClient.failNext(
      { message: "falha ao salvar extração" },
      { table: "extraction_results", operation: "insert" },
    );

    await expect(
      persistExtractionResult({
        tenantId: "tenant-a",
        documentId: "doc-a-invoice",
        model: "modelo-teste",
        payload: {},
      }),
    ).rejects.toThrow("falha ao salvar extração");
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

  it("propaga erro ao ler as versões existentes", async () => {
    readClient.failNext(
      { message: "falha ao versionar" },
      { table: "documents", operation: "select" },
    );

    await expect(
      insertDocuments({
        tenantId: "tenant-a",
        importId: "import-insert",
        types: ["invoice"],
        storagePath: "tenant-a/novo.pdf",
        sha256: "sha-novo",
        filename: "novo.pdf",
        mediaType: "application/pdf",
        sizeBytes: 321,
      }),
    ).rejects.toThrow("falha ao versionar");
  });

  it("incrementa a versão a partir do maior valor existente do tenant", async () => {
    const inserted = await insertDocuments({
      tenantId: "tenant-a",
      importId: "import-shared",
      types: ["invoice", "bill_of_lading"],
      storagePath: "tenant-a/revisao.pdf",
      sha256: "sha-revisao",
      filename: "revisao.pdf",
      mediaType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(inserted).toHaveLength(2);
    for (const document of inserted) {
      expect(findRow("documents", document.id).version).toBe(2);
    }
    expect(findRow("documents", "doc-b-invoice").version).toBe(5);
  });

  it("propaga erro ao gravar os documentos", async () => {
    adminClient.failNext(
      { message: "falha ao registrar documentos" },
      { table: "documents", operation: "insert" },
    );

    await expect(
      insertDocuments({
        tenantId: "tenant-a",
        importId: "import-insert",
        types: ["invoice"],
        storagePath: "tenant-a/novo.pdf",
        sha256: "sha-novo",
        filename: "novo.pdf",
        mediaType: "application/pdf",
        sizeBytes: 321,
      }),
    ).rejects.toThrow("falha ao registrar documentos");
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

  it("propaga erro ao listar os documentos da origem", async () => {
    readClient.failNext(
      { message: "falha ao listar documentos da origem" },
      { table: "documents", operation: "select" },
    );

    await expect(
      moveDocumentsToImport({
        tenantId: "tenant-a",
        sourceImportId: "import-source",
        targetImportId: "import-target",
      }),
    ).rejects.toThrow("falha ao listar documentos da origem");
  });

  it("propaga erro ao mover os documentos no destino", async () => {
    adminClient.failNext(
      { message: "falha ao mover documento" },
      { table: "documents", operation: "update" },
    );

    await expect(
      moveDocumentsToImport({
        tenantId: "tenant-a",
        sourceImportId: "import-source",
        targetImportId: "import-target",
      }),
    ).rejects.toThrow("falha ao mover documento");
  });

  it("não altera nada quando a origem não possui documentos", async () => {
    await moveDocumentsToImport({
      tenantId: "tenant-a",
      sourceImportId: "import-sem-documentos",
      targetImportId: "import-target",
    });

    expect(findRow("documents", "doc-a-target").version).toBe(2);
  });

  it("propaga erro ao versionar os documentos no destino", async () => {
    mocks.readClient = readClientWithSecondSelectFailure(
      "falha ao versionar no destino",
    );

    await expect(
      moveDocumentsToImport({
        tenantId: "tenant-a",
        sourceImportId: "import-source",
        targetImportId: "import-target",
      }),
    ).rejects.toThrow("falha ao versionar no destino");

    expect(findRow("documents", "doc-a-source").import_id).toBe(
      "import-source",
    );
  });
});
