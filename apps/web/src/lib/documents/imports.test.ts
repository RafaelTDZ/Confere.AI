import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAutoReferenceIfNeeded,
  deleteImportRecord,
  fillImportKeysIfEmpty,
  findOrCreateImport,
  getImportDetail,
  ImportConflictError,
  ImportValidationError,
  listTenantImports,
  updateImportRecord,
} from "@/lib/documents/imports";
import { ImportNotFoundError } from "@/lib/documents/parties";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const CREATED_EARLY = "2026-01-01T00:00:00.000Z";
const CREATED_MID = "2026-02-01T00:00:00.000Z";
const CREATED_LATE = "2026-03-01T00:00:00.000Z";

function importSeed(params: {
  id: string;
  tenantId: string;
  referenceNumber?: string | null;
  status?: string;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  blNumber?: string | null;
  createdAt?: string;
  updatedAt?: string;
  consigneeId?: string | null;
  notifyId?: string | null;
}): FakeRow {
  const createdAt = params.createdAt ?? CREATED_EARLY;
  return {
    id: params.id,
    tenant_id: params.tenantId,
    reference_number: params.referenceNumber ?? null,
    status: params.status ?? "processing",
    supplier_name: params.supplierName ?? null,
    invoice_number: params.invoiceNumber ?? null,
    bl_number: params.blNumber ?? null,
    created_at: createdAt,
    updated_at: params.updatedAt ?? createdAt,
    created_by: "user-seed",
    consignee_id: params.consigneeId ?? null,
    notify_id: params.notifyId ?? null,
  };
}

function documentSeed(params: {
  id: string;
  tenantId: string;
  importId: string;
  docType: string;
  storagePath?: string;
  version?: number;
  status?: string;
  createdAt?: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    import_id: params.importId,
    doc_type: params.docType,
    storage_path: params.storagePath ?? `${params.tenantId}/${params.id}.pdf`,
    sha256: `sha-${params.id}`,
    version: params.version ?? 1,
    status: params.status ?? "extracted",
    original_filename: `${params.id}.pdf`,
    content_type: "application/pdf",
    size_bytes: 1024,
    created_at: params.createdAt ?? CREATED_EARLY,
  };
}

function extractionSeed(params: {
  id: string;
  documentId: string;
  payload: unknown;
  createdAt: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: TENANT_A,
    document_id: params.documentId,
    payload: params.payload,
    created_at: params.createdAt,
  };
}

function partySeed(params: {
  id: string;
  tenantId: string;
  name: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    name: params.name,
    cnpj: "11.222.333/0001-81",
    cnpj_digits: "11222333000181",
    address: "Rua A, 100",
    street: "Rua A",
    street_number: "100",
    complement: null,
    postal_code: null,
    city: "São Paulo",
    state: "SP",
    country: "Brasil",
    other_info: null,
    created_at: CREATED_EARLY,
    updated_at: CREATED_EARLY,
  };
}

function seedAdmin(): FakeSupabase {
  return new FakeSupabase({
    imports: [
      importSeed({
        id: "import-a-early",
        tenantId: TENANT_A,
        referenceNumber: "PO-A-EARLY",
        createdAt: CREATED_EARLY,
      }),
      importSeed({
        id: "import-shared",
        tenantId: TENANT_A,
        referenceNumber: "PO-SHARED-A",
        invoiceNumber: "INV-SHARED-A",
        createdAt: CREATED_MID,
      }),
      importSeed({
        id: "import-a-late",
        tenantId: TENANT_A,
        referenceNumber: "PO-A-LATE",
        createdAt: CREATED_LATE,
      }),
      importSeed({
        id: "import-shared",
        tenantId: TENANT_B,
        referenceNumber: "PO-SHARED-B",
        invoiceNumber: "INV-SHARED-B",
        createdAt: CREATED_MID,
      }),
      importSeed({
        id: "import-by-bl",
        tenantId: TENANT_A,
        referenceNumber: "IMP-20261023-AB12CD",
        blNumber: "BL-EXISTING",
        status: "uploaded",
        createdAt: "2026-01-15T00:00:00.000Z",
      }),
      importSeed({
        id: "import-by-invoice",
        tenantId: TENANT_A,
        referenceNumber: "PO-MANUAL",
        invoiceNumber: "INV-EXISTING",
        supplierName: "Fornecedor Existente",
        status: "completed",
        createdAt: "2026-01-16T00:00:00.000Z",
      }),
      importSeed({
        id: "import-b-by-bl",
        tenantId: TENANT_B,
        blNumber: "BL-CROSS",
        invoiceNumber: "INV-CROSS",
        status: "completed",
        createdAt: "2026-01-20T00:00:00.000Z",
      }),
      importSeed({
        id: "import-detail",
        tenantId: TENANT_A,
        referenceNumber: "PO-DETAIL",
        status: "awaiting_review",
        supplierName: "Fornecedor Detail",
        invoiceNumber: "INV-DETAIL",
        blNumber: "BL-DETAIL",
        consigneeId: "party-a-consignee",
        notifyId: "party-a-notify",
        createdAt: "2026-01-10T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      }),
      importSeed({
        id: "import-detail-empty",
        tenantId: TENANT_A,
        createdAt: "2026-01-11T00:00:00.000Z",
      }),
      importSeed({
        id: "import-update",
        tenantId: TENANT_A,
        referenceNumber: "PO-UPDATE",
        supplierName: "Fornecedor Antigo",
        invoiceNumber: "INV-UPDATE",
        blNumber: "BL-UPDATE",
        createdAt: "2026-01-12T00:00:00.000Z",
      }),
      importSeed({
        id: "import-update-invoice",
        tenantId: TENANT_A,
        invoiceNumber: "INV-UPDATE-2",
        createdAt: "2026-01-13T00:00:00.000Z",
      }),
      importSeed({
        id: "import-merge-source",
        tenantId: TENANT_A,
        referenceNumber: "PO-SOURCE",
        supplierName: "Fornecedor Origem",
        invoiceNumber: "INV-MERGE",
        blNumber: "BL-MERGE",
        consigneeId: "party-a-consignee",
        notifyId: "party-a-notify",
        createdAt: "2026-01-14T00:00:00.000Z",
      }),
      importSeed({
        id: "import-merge-target",
        tenantId: TENANT_A,
        referenceNumber: "PO-TARGET",
        createdAt: "2026-01-09T00:00:00.000Z",
      }),
    ],
    documents: [
      documentSeed({
        id: "doc-shared-a-invoice",
        tenantId: TENANT_A,
        importId: "import-shared",
        docType: "invoice",
        storagePath: "tenant-a/shared.pdf",
      }),
      documentSeed({
        id: "doc-shared-a-packing",
        tenantId: TENANT_A,
        importId: "import-shared",
        docType: "packing_list",
        storagePath: "tenant-a/shared.pdf",
      }),
      documentSeed({
        id: "doc-shared-a-bl",
        tenantId: TENANT_A,
        importId: "import-shared",
        docType: "bill_of_lading",
        storagePath: "tenant-a/shared-extra.pdf",
      }),
      documentSeed({
        id: "doc-shared-b-invoice",
        tenantId: TENANT_B,
        importId: "import-shared",
        docType: "invoice",
        storagePath: "tenant-b/shared.pdf",
      }),
      documentSeed({
        id: "doc-detail-invoice",
        tenantId: TENANT_A,
        importId: "import-detail",
        docType: "invoice",
        createdAt: "2026-01-10T00:00:00.000Z",
      }),
      documentSeed({
        id: "doc-detail-bl",
        tenantId: TENANT_A,
        importId: "import-detail",
        docType: "bill_of_lading",
        createdAt: "2026-01-11T00:00:00.000Z",
      }),
      documentSeed({
        id: "doc-merge-target",
        tenantId: TENANT_A,
        importId: "import-merge-target",
        docType: "invoice",
        version: 2,
        createdAt: "2026-01-09T00:00:00.000Z",
      }),
      documentSeed({
        id: "doc-merge-source",
        tenantId: TENANT_A,
        importId: "import-merge-source",
        docType: "invoice",
        version: 1,
        createdAt: "2026-01-14T00:00:00.000Z",
      }),
    ],
    extraction_results: [
      extractionSeed({
        id: "extraction-detail-invoice-old",
        documentId: "doc-detail-invoice",
        payload: { number: "INV-OLD" },
        createdAt: "2026-01-10T00:00:00.000Z",
      }),
      extractionSeed({
        id: "extraction-detail-invoice-new",
        documentId: "doc-detail-invoice",
        payload: { number: "INV-NEW" },
        createdAt: "2026-02-10T00:00:00.000Z",
      }),
      extractionSeed({
        id: "extraction-detail-bl",
        documentId: "doc-detail-bl",
        payload: { number: "BL-DETAIL" },
        createdAt: "2026-01-11T00:00:00.000Z",
      }),
    ],
    parties: [
      partySeed({
        id: "party-a-consignee",
        tenantId: TENANT_A,
        name: "Consignatário A",
      }),
      partySeed({
        id: "party-a-notify",
        tenantId: TENANT_A,
        name: "Notify A",
      }),
      partySeed({
        id: "party-b-consignee",
        tenantId: TENANT_B,
        name: "Consignatário B",
      }),
    ],
    analysis_results: [
      {
        id: "analysis-merge",
        tenant_id: TENANT_A,
        import_id: "import-merge-source",
        status: "done",
      },
    ],
    product_matches: [
      {
        id: "match-merge",
        tenant_id: TENANT_A,
        import_id: "import-merge-source",
        ncm: "12345678",
      },
    ],
  });
}

let admin: FakeSupabase;

beforeEach(() => {
  admin = seedAdmin();
  mocks.admin = admin;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function findRow(table: string, id: string): FakeRow {
  const row = admin.rows(table).find((candidate) => candidate.id === id);
  if (!row) {
    throw new Error(`Linha ${table}/${id} não encontrada`);
  }
  return row;
}

function findImport(id: string, tenantId: string): FakeRow | undefined {
  return admin
    .rows("imports")
    .find(
      (candidate) => candidate.id === id && candidate.tenant_id === tenantId,
    );
}

function importsUpdates(): number {
  return admin.queries.filter(
    (query) => query.table === "imports" && query.operation === "update",
  ).length;
}

describe("listTenantImports", () => {
  it("retorna somente as importações do tenant ordenadas por created_at desc", async () => {
    const imports = await listTenantImports(TENANT_A);

    expect(imports.map((row) => row.id)).toEqual([
      "import-a-late",
      "import-shared",
      "import-by-invoice",
      "import-by-bl",
      "import-merge-source",
      "import-update-invoice",
      "import-update",
      "import-detail-empty",
      "import-detail",
      "import-merge-target",
      "import-a-early",
    ]);
    expect(imports.some((row) => row.id === "import-b-by-bl")).toBe(false);
    expect(imports).not.toContainEqual(
      expect.objectContaining({ reference_number: "PO-SHARED-B" }),
    );
  });

  it("propaga erro do banco ao listar", async () => {
    admin.failNext(
      { message: "conexão indisponível" },
      { table: "imports", operation: "select" },
    );

    await expect(listTenantImports(TENANT_A)).rejects.toThrow(
      "conexão indisponível",
    );
  });
});

describe("deleteImportRecord", () => {
  it("remove a importação do próprio tenant e os arquivos únicos do Storage", async () => {
    await deleteImportRecord(TENANT_A, "import-shared");

    expect(findImport("import-shared", TENANT_A)).toBeUndefined();
    expect(findImport("import-shared", TENANT_B)).toBeDefined();
    expect(admin.storage.removals).toEqual([
      {
        bucket: "import-documents",
        paths: ["tenant-a/shared.pdf", "tenant-a/shared-extra.pdf"],
      },
    ]);
  });

  it("lança ImportNotFoundError para importação de outro tenant sem remover arquivos", async () => {
    await expect(
      deleteImportRecord(TENANT_B, "import-a-early"),
    ).rejects.toBeInstanceOf(ImportNotFoundError);

    expect(findImport("import-a-early", TENANT_A)).toBeDefined();
    expect(admin.storage.removals).toHaveLength(0);
  });

  it("lança ImportNotFoundError para id inexistente", async () => {
    await expect(
      deleteImportRecord(TENANT_A, "import-inexistente"),
    ).rejects.toBeInstanceOf(ImportNotFoundError);

    expect(admin.storage.removals).toHaveLength(0);
  });

  it("registra falha do Storage sem lançar e mantém a importação removida", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    admin.storage.removeError = { message: "storage offline" };

    await expect(
      deleteImportRecord(TENANT_A, "import-shared"),
    ).resolves.toBeUndefined();

    expect(findImport("import-shared", TENANT_A)).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "[imports delete] Falha ao remover arquivos do Storage",
      { message: "storage offline" },
    );
  });

  it("propaga erro do banco ao remover", async () => {
    admin.failNext(
      { message: "falha ao excluir" },
      { table: "imports", operation: "delete" },
    );

    await expect(deleteImportRecord(TENANT_A, "import-shared")).rejects.toThrow(
      "falha ao excluir",
    );

    expect(findImport("import-shared", TENANT_A)).toBeDefined();
    expect(admin.storage.removals).toHaveLength(0);
  });
});

describe("findOrCreateImport", () => {
  it("encontra pelo BL, preenche chaves vazias, limpa referência automática e marca processing", async () => {
    const result = await findOrCreateImport({
      tenantId: TENANT_A,
      userId: "user-a",
      invoiceNumber: "INV-NOVA",
      blNumber: "BL-EXISTING",
      supplierName: "Fornecedor Novo",
    });

    expect(result).toEqual({ importId: "import-by-bl", created: false });
    expect(findImport("import-by-bl", TENANT_A)).toMatchObject({
      invoice_number: "INV-NOVA",
      bl_number: "BL-EXISTING",
      supplier_name: "Fornecedor Novo",
      reference_number: null,
      status: "processing",
    });
  });

  it("encontra pela Invoice quando não há BL", async () => {
    const result = await findOrCreateImport({
      tenantId: TENANT_A,
      userId: "user-a",
      invoiceNumber: "INV-EXISTING",
      blNumber: null,
      supplierName: "Fornecedor Ignorado",
    });

    expect(result).toEqual({
      importId: "import-by-invoice",
      created: false,
    });
    expect(findImport("import-by-invoice", TENANT_A)).toMatchObject({
      invoice_number: "INV-EXISTING",
      bl_number: null,
      supplier_name: "Fornecedor Existente",
      reference_number: "PO-MANUAL",
      status: "processing",
    });
  });

  it("cria a importação com tenant, usuário, status e fornecedor aparado", async () => {
    const result = await findOrCreateImport({
      tenantId: TENANT_A,
      userId: "user-a",
      invoiceNumber: "INV-CRIADA",
      blNumber: "BL-CRIADO",
      supplierName: "  Fornecedor Criado  ",
    });

    expect(result.created).toBe(true);
    const created = findImport(result.importId, TENANT_A);
    expect(created).toMatchObject({
      tenant_id: TENANT_A,
      created_by: "user-a",
      status: "processing",
      reference_number: null,
      invoice_number: "INV-CRIADA",
      bl_number: "BL-CRIADO",
      supplier_name: "Fornecedor Criado",
    });
  });

  it("não reutiliza importação de outro tenant com o mesmo BL ou Invoice", async () => {
    const result = await findOrCreateImport({
      tenantId: TENANT_A,
      userId: "user-a",
      invoiceNumber: "INV-CROSS",
      blNumber: "BL-CROSS",
      supplierName: "Fornecedor A",
    });

    expect(result.created).toBe(true);
    expect(result.importId).not.toBe("import-b-by-bl");
    expect(findImport(result.importId, TENANT_A)).toMatchObject({
      tenant_id: TENANT_A,
      bl_number: "BL-CROSS",
      invoice_number: "INV-CROSS",
    });
    expect(findImport("import-b-by-bl", TENANT_B)).toMatchObject({
      status: "completed",
      bl_number: "BL-CROSS",
    });
  });

  it("propaga erro ao buscar importação existente", async () => {
    admin.failNext(
      { message: "falha ao buscar" },
      { table: "imports", operation: "select" },
    );

    await expect(
      findOrCreateImport({
        tenantId: TENANT_A,
        userId: "user-a",
        invoiceNumber: "INV-QUALQUER",
        blNumber: "BL-QUALQUER",
        supplierName: null,
      }),
    ).rejects.toThrow("falha ao buscar");
  });
});

describe("getImportDetail", () => {
  it("lança ImportNotFoundError para importação de outro tenant", async () => {
    await expect(
      getImportDetail(TENANT_A, "import-b-by-bl"),
    ).rejects.toBeInstanceOf(ImportNotFoundError);
  });

  it("lança ImportNotFoundError para id inexistente", async () => {
    await expect(
      getImportDetail(TENANT_A, "import-inexistente"),
    ).rejects.toBeInstanceOf(ImportNotFoundError);
  });

  it("devolve campos, documentos, partes e extrações mais recentes", async () => {
    const detail = await getImportDetail(TENANT_A, "import-detail");

    expect(detail).toMatchObject({
      id: "import-detail",
      reference_number: "PO-DETAIL",
      status: "awaiting_review",
      supplier_name: "Fornecedor Detail",
      invoice_number: "INV-DETAIL",
      bl_number: "BL-DETAIL",
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-02-10T00:00:00.000Z",
      consignee: { id: "party-a-consignee", name: "Consignatário A" },
      notify: { id: "party-a-notify", name: "Notify A" },
    });
    expect(detail.documents.map((document) => document.id)).toEqual([
      "doc-detail-invoice",
      "doc-detail-bl",
    ]);
    expect(detail.invoice).toEqual({ number: "INV-NEW" });
    expect(detail.bl).toEqual({ number: "BL-DETAIL" });
  });

  it("devolve extrações e partes nulas sem documentos", async () => {
    const detail = await getImportDetail(TENANT_A, "import-detail-empty");

    expect(detail).toMatchObject({
      id: "import-detail-empty",
      reference_number: null,
      supplier_name: null,
      invoice_number: null,
      bl_number: null,
      consignee: null,
      notify: null,
      documents: [],
      invoice: null,
      bl: null,
    });
  });

  it("propaga erro ao listar documentos", async () => {
    admin.failNext(
      { message: "falha ao listar documentos" },
      { table: "documents", operation: "select" },
    );

    await expect(getImportDetail(TENANT_A, "import-detail")).rejects.toThrow(
      "falha ao listar documentos",
    );
  });

  it("propaga erro ao buscar extração", async () => {
    admin.failNext(
      { message: "falha ao buscar extração" },
      { table: "extraction_results", operation: "select" },
    );

    await expect(getImportDetail(TENANT_A, "import-detail")).rejects.toThrow(
      "falha ao buscar extração",
    );
  });

  it("propaga erro ao buscar partes", async () => {
    admin.failNext(
      { message: "falha ao buscar parte" },
      { table: "parties", operation: "select" },
    );

    await expect(getImportDetail(TENANT_A, "import-detail")).rejects.toThrow(
      "falha ao buscar parte",
    );
  });
});

describe("updateImportRecord", () => {
  it("normaliza a referência e apara o nome do fornecedor", async () => {
    const detail = await updateImportRecord(TENANT_A, "import-update", {
      referenceNumber: "  po-abc   123  ",
      supplierName: "  Fornecedor Editado  ",
    });

    expect(detail.reference_number).toBe("PO-ABC 123");
    expect(detail.supplier_name).toBe("Fornecedor Editado");
    expect(findImport("import-update", TENANT_A)).toMatchObject({
      reference_number: "PO-ABC 123",
      supplier_name: "Fornecedor Editado",
    });
  });

  it("usa o BL salvo quando a referência informada é vazia", async () => {
    const detail = await updateImportRecord(TENANT_A, "import-update", {
      referenceNumber: "   ",
    });

    expect(detail.reference_number).toBe("BL-UPDATE");
    expect(detail.supplier_name).toBe("Fornecedor Antigo");
  });

  it("usa a Invoice salva quando não há BL e a referência é vazia", async () => {
    const detail = await updateImportRecord(TENANT_A, "import-update-invoice", {
      referenceNumber: "",
    });

    expect(detail.reference_number).toBe("INV-UPDATE-2");
    expect(detail.bl_number).toBeNull();
  });

  it("mantém o fornecedor quando supplierName é indefinido", async () => {
    const detail = await updateImportRecord(TENANT_A, "import-update", {
      referenceNumber: "PO-COM-FORNECEDOR",
    });

    expect(detail.reference_number).toBe("PO-COM-FORNECEDOR");
    expect(detail.supplier_name).toBe("Fornecedor Antigo");
  });

  it("grava null quando supplierName é null", async () => {
    const detail = await updateImportRecord(TENANT_A, "import-update", {
      referenceNumber: "PO-SEM-FORNECEDOR",
      supplierName: null,
    });

    expect(detail.reference_number).toBe("PO-SEM-FORNECEDOR");
    expect(detail.supplier_name).toBeNull();
    expect(findImport("import-update", TENANT_A)?.supplier_name).toBeNull();
  });

  it("grava null quando supplierName é vazio", async () => {
    const detail = await updateImportRecord(TENANT_A, "import-update", {
      referenceNumber: "PO-ESPACOS",
      supplierName: "   ",
    });

    expect(detail.reference_number).toBe("PO-ESPACOS");
    expect(detail.supplier_name).toBeNull();
  });

  it("rejeita referência com mais de 120 caracteres sem atualizar", async () => {
    await expect(
      updateImportRecord(TENANT_A, "import-update", {
        referenceNumber: "X".repeat(121),
      }),
    ).rejects.toBeInstanceOf(ImportValidationError);

    expect(importsUpdates()).toBe(0);
    expect(findImport("import-update", TENANT_A)?.reference_number).toBe(
      "PO-UPDATE",
    );
  });

  it("faz merge da importação de origem na importação de referência duplicada", async () => {
    admin.failNext(
      {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
      { table: "imports", operation: "update" },
    );

    const detail = await updateImportRecord(TENANT_A, "import-merge-source", {
      referenceNumber: "po-target",
      supplierName: "Fornecedor Mesclado",
    });

    expect(detail).toMatchObject({
      id: "import-merge-target",
      reference_number: "PO-TARGET",
      invoice_number: "INV-MERGE",
      bl_number: "BL-MERGE",
      supplier_name: "Fornecedor Mesclado",
      consignee: { id: "party-a-consignee", name: "Consignatário A" },
      notify: { id: "party-a-notify", name: "Notify A" },
    });
    expect(detail.documents.map((document) => document.id)).toEqual([
      "doc-merge-target",
      "doc-merge-source",
    ]);
    expect(findImport("import-merge-source", TENANT_A)).toBeUndefined();
    expect(findRow("documents", "doc-merge-source")).toMatchObject({
      import_id: "import-merge-target",
      version: 3,
    });
    expect(findRow("analysis_results", "analysis-merge")).toMatchObject({
      import_id: "import-merge-target",
    });
    expect(findRow("product_matches", "match-merge")).toMatchObject({
      import_id: "import-merge-target",
    });
  });

  it("lança ImportConflictError quando a referência duplicada é a própria importação", async () => {
    admin.failNext(
      { code: "23505", message: "duplicate key" },
      { table: "imports", operation: "update" },
    );

    await expect(
      updateImportRecord(TENANT_A, "import-update", {
        referenceNumber: "po-update",
      }),
    ).rejects.toBeInstanceOf(ImportConflictError);
  });

  it("lança ImportConflictError quando a referência duplicada não é encontrada", async () => {
    admin.failNext(
      { code: "23505", message: "duplicate key" },
      { table: "imports", operation: "update" },
    );

    await expect(
      updateImportRecord(TENANT_A, "import-update", {
        referenceNumber: "PO-INEXISTENTE",
      }),
    ).rejects.toBeInstanceOf(ImportConflictError);
  });

  it("propaga erro genérico do update", async () => {
    admin.failNext(
      { message: "falha ao atualizar" },
      { table: "imports", operation: "update" },
    );

    await expect(
      updateImportRecord(TENANT_A, "import-update", {
        referenceNumber: "PO-NOVA",
      }),
    ).rejects.toThrow("falha ao atualizar");
  });

  it("propaga erro ao mover resultados da análise durante o merge", async () => {
    admin.failNext(
      { code: "23505", message: "duplicate key" },
      { table: "imports", operation: "update" },
    );
    admin.failNext(
      { message: "falha ao mover análise" },
      { table: "analysis_results", operation: "update" },
    );

    await expect(
      updateImportRecord(TENANT_A, "import-merge-source", {
        referenceNumber: "PO-TARGET",
      }),
    ).rejects.toThrow("falha ao mover análise");
  });

  it("propaga erro ao mover correspondências durante o merge", async () => {
    admin.failNext(
      { code: "23505", message: "duplicate key" },
      { table: "imports", operation: "update" },
    );
    admin.failNext(
      { message: "falha ao mover correspondências" },
      { table: "product_matches", operation: "update" },
    );

    await expect(
      updateImportRecord(TENANT_A, "import-merge-source", {
        referenceNumber: "PO-TARGET",
      }),
    ).rejects.toThrow("falha ao mover correspondências");
  });

  it("propaga erro ao remover a importação de origem durante o merge", async () => {
    admin.failNext(
      { code: "23505", message: "duplicate key" },
      { table: "imports", operation: "update" },
    );
    admin.failNext(
      { message: "falha ao excluir origem" },
      { table: "imports", operation: "delete" },
    );

    await expect(
      updateImportRecord(TENANT_A, "import-merge-source", {
        referenceNumber: "PO-TARGET",
      }),
    ).rejects.toThrow("falha ao excluir origem");

    expect(findImport("import-merge-source", TENANT_A)).toBeDefined();
  });
});

describe("fillImportKeysIfEmpty", () => {
  it("não atualiza quando as chaves já estão preenchidas", async () => {
    await fillImportKeysIfEmpty({
      tenantId: TENANT_A,
      importId: "import-update",
      invoiceNumber: "INV-OUTRA",
      blNumber: "BL-OUTRO",
      supplierName: "Fornecedor Outro",
    });

    expect(importsUpdates()).toBe(0);
    expect(findImport("import-update", TENANT_A)).toMatchObject({
      invoice_number: "INV-UPDATE",
      bl_number: "BL-UPDATE",
      supplier_name: "Fornecedor Antigo",
    });
  });

  it("propaga erro de select", async () => {
    admin.failNext(
      { message: "falha ao buscar chaves" },
      { table: "imports", operation: "select" },
    );

    await expect(
      fillImportKeysIfEmpty({
        tenantId: TENANT_A,
        importId: "import-by-bl",
        blNumber: "BL-NOVO",
      }),
    ).rejects.toThrow("falha ao buscar chaves");
  });

  it("propaga erro de update", async () => {
    admin.failNext(
      { message: "falha ao atualizar chaves" },
      { table: "imports", operation: "update" },
    );

    await expect(
      fillImportKeysIfEmpty({
        tenantId: TENANT_A,
        importId: "import-by-invoice",
        blNumber: "BL-NOVO",
      }),
    ).rejects.toThrow("falha ao atualizar chaves");

    expect(findImport("import-by-invoice", TENANT_A)?.bl_number).toBeNull();
  });
});

describe("clearAutoReferenceIfNeeded", () => {
  it("não atualiza quando não há reference_number", async () => {
    await clearAutoReferenceIfNeeded({
      tenantId: TENANT_A,
      importId: "import-update-invoice",
    });

    expect(importsUpdates()).toBe(0);
    expect(
      findImport("import-update-invoice", TENANT_A)?.reference_number,
    ).toBeNull();
  });

  it("limpa a referência gerada automaticamente", async () => {
    await clearAutoReferenceIfNeeded({
      tenantId: TENANT_A,
      importId: "import-by-bl",
    });

    expect(findImport("import-by-bl", TENANT_A)?.reference_number).toBeNull();
  });

  it("mantém a referência manual", async () => {
    await clearAutoReferenceIfNeeded({
      tenantId: TENANT_A,
      importId: "import-update",
    });

    expect(importsUpdates()).toBe(0);
    expect(findImport("import-update", TENANT_A)?.reference_number).toBe(
      "PO-UPDATE",
    );
  });

  it("propaga erro de select", async () => {
    admin.failNext(
      { message: "falha ao buscar referência" },
      { table: "imports", operation: "select" },
    );

    await expect(
      clearAutoReferenceIfNeeded({
        tenantId: TENANT_A,
        importId: "import-by-bl",
      }),
    ).rejects.toThrow("falha ao buscar referência");
  });

  it("propaga erro de update", async () => {
    admin.failNext(
      { message: "falha ao limpar referência" },
      { table: "imports", operation: "update" },
    );

    await expect(
      clearAutoReferenceIfNeeded({
        tenantId: TENANT_A,
        importId: "import-by-bl",
      }),
    ).rejects.toThrow("falha ao limpar referência");

    expect(findImport("import-by-bl", TENANT_A)?.reference_number).toBe(
      "IMP-20261023-AB12CD",
    );
  });
});
