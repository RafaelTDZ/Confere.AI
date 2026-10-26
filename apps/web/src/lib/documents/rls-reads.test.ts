import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findDocumentsBySha256,
  findTenantDocumentsBySha256,
  listImportStoragePaths,
} from "@/lib/documents/documents";
import { findLatestExtractionsByDocumentIds } from "@/lib/documents/extractions";
import { getImportDetail, listTenantImports } from "@/lib/documents/imports";
import {
  getNcmById,
  listTenantNcms,
  NcmNotFoundError,
} from "@/lib/documents/ncms";
import { assertDocumentOwnership } from "@/lib/documents/ownership";
import {
  getPartyById,
  ImportNotFoundError,
  listTenantParties,
  PartyNotFoundError,
} from "@/lib/documents/parties";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  readClient: undefined as unknown,
  adminCalls: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    mocks.adminCalls += 1;
    throw new Error("admin não deveria ser usado em leitura");
  },
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.readClient,
}));

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const CREATED_EARLY = "2026-01-01T00:00:00.000Z";
const CREATED_LATE = "2026-02-01T00:00:00.000Z";
const SHA_INVOICE_A = "sha-doc-a";

const INVOICE_PAYLOAD = {
  number: "INV-A",
  exporter: { name: "Exportador A" },
  importer: { name: "Empresa A" },
  notify: { name: "Empresa A" },
};

const BL_PAYLOAD = {
  number: "BL-A",
  consignee: "Empresa A",
};

function importSeed(params: {
  id: string;
  tenantId: string;
  referenceNumber?: string | null;
  status?: string;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  blNumber?: string | null;
  consigneeId?: string | null;
  notifyId?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
    created_by: "user-seed",
    consignee_id: params.consigneeId ?? null,
    notify_id: params.notifyId ?? null,
    created_at: createdAt,
    updated_at: params.updatedAt ?? createdAt,
  };
}

function documentSeed(params: {
  id: string;
  tenantId: string;
  importId: string;
  docType: string;
  sha256: string;
  storagePath: string;
  createdAt?: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    import_id: params.importId,
    doc_type: params.docType,
    storage_path: params.storagePath,
    sha256: params.sha256,
    version: 1,
    status: "extracted",
    original_filename: `${params.id}.pdf`,
    content_type: "application/pdf",
    size_bytes: 1024,
    created_at: params.createdAt ?? CREATED_EARLY,
  };
}

function extractionSeed(params: {
  id: string;
  tenantId: string;
  documentId: string;
  payload: unknown;
  tokensUsed: number;
  createdAt: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    document_id: params.documentId,
    model: "modelo-teste",
    payload: params.payload,
    tokens_used: params.tokensUsed,
    created_at: params.createdAt,
  };
}

function partySeed(params: {
  id: string;
  tenantId: string;
  name: string;
  cnpj: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    name: params.name,
    cnpj: params.cnpj,
    cnpj_digits: params.cnpj.replace(/\D/g, ""),
    address: "Rua A, 100",
    street: "Rua A",
    street_number: "100",
    complement: null,
    postal_code: "01000-000",
    city: "São Paulo",
    state: "SP",
    country: "Brasil",
    other_info: null,
    created_at: CREATED_EARLY,
    updated_at: CREATED_EARLY,
  };
}

function ncmSeed(params: {
  id: string;
  tenantId: string;
  code: string;
  description: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    code: params.code,
    description: params.description,
    created_at: CREATED_EARLY,
    updated_at: CREATED_EARLY,
  };
}

/**
 * Seeds com os mesmos identificadores compartilhados entre tenants
 * (`sha256` e `import_id` repetidos) para provar que o filtro por tenant e o
 * client de leitura RLS são suficientes.
 */
function seedReadData(): FakeSupabase {
  return new FakeSupabase({
    imports: [
      importSeed({
        id: "import-a",
        tenantId: TENANT_A,
        referenceNumber: "REF-A",
        status: "awaiting_review",
        supplierName: "Fornecedor A",
        invoiceNumber: "INV-A",
        blNumber: "BL-A",
        consigneeId: "party-a",
        notifyId: "party-a",
        createdAt: CREATED_EARLY,
        updatedAt: CREATED_LATE,
      }),
      importSeed({
        id: "import-b",
        tenantId: TENANT_B,
        referenceNumber: "REF-B",
        supplierName: "Fornecedor B",
        invoiceNumber: "INV-B",
        createdAt: CREATED_LATE,
      }),
    ],
    documents: [
      documentSeed({
        id: "doc-a",
        tenantId: TENANT_A,
        importId: "import-a",
        docType: "invoice",
        sha256: SHA_INVOICE_A,
        storagePath: "tenant-a/import-a/doc-a.pdf",
        createdAt: CREATED_EARLY,
      }),
      documentSeed({
        id: "doc-a-bl",
        tenantId: TENANT_A,
        importId: "import-a",
        docType: "bill_of_lading",
        sha256: "sha-doc-a-bl",
        storagePath: "tenant-a/import-a/doc-a-bl.pdf",
        createdAt: CREATED_LATE,
      }),
      documentSeed({
        id: "doc-b",
        tenantId: TENANT_B,
        importId: "import-b",
        docType: "invoice",
        sha256: SHA_INVOICE_A,
        storagePath: "tenant-b/import-b/doc-b.pdf",
        createdAt: CREATED_EARLY,
      }),
    ],
    extraction_results: [
      extractionSeed({
        id: "extraction-a",
        tenantId: TENANT_A,
        documentId: "doc-a",
        payload: INVOICE_PAYLOAD,
        tokensUsed: 42,
        createdAt: CREATED_EARLY,
      }),
      extractionSeed({
        id: "extraction-a-bl",
        tenantId: TENANT_A,
        documentId: "doc-a-bl",
        payload: BL_PAYLOAD,
        tokensUsed: 17,
        createdAt: CREATED_LATE,
      }),
      extractionSeed({
        id: "extraction-b",
        tenantId: TENANT_B,
        documentId: "doc-b",
        payload: { number: "INV-B" },
        tokensUsed: 99,
        createdAt: CREATED_EARLY,
      }),
    ],
    parties: [
      partySeed({
        id: "party-a",
        tenantId: TENANT_A,
        name: "Empresa A",
        cnpj: "11.222.333/0001-81",
      }),
      partySeed({
        id: "party-b",
        tenantId: TENANT_B,
        name: "Empresa B",
        cnpj: "44.555.666/0001-27",
      }),
    ],
    ncms: [
      ncmSeed({
        id: "ncm-a",
        tenantId: TENANT_A,
        code: "12345678",
        description: "Produto A",
      }),
      ncmSeed({
        id: "ncm-b",
        tenantId: TENANT_B,
        code: "87654321",
        description: "Produto B",
      }),
    ],
  });
}

beforeEach(() => {
  mocks.adminCalls = 0;
  mocks.readClient = seedReadData();
});

afterEach(() => {
  expect(mocks.adminCalls).toBe(0);
});

describe("leituras públicas de documents", () => {
  it("lista somente as importações do tenant com o client de leitura", async () => {
    const page = await listTenantImports(TENANT_A);

    expect(page.rows.map((row) => row.id)).toEqual(["import-a"]);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      reference_number: "REF-A",
      status: "awaiting_review",
      supplier_name: "Fornecedor A",
      invoice_number: "INV-A",
      bl_number: "BL-A",
      created_at: CREATED_EARLY,
    });
  });

  it("carrega o detalhe com documentos, extrações e partes via RLS", async () => {
    const detail = await getImportDetail(TENANT_A, "import-a");

    expect(detail).toMatchObject({
      id: "import-a",
      reference_number: "REF-A",
      status: "awaiting_review",
      supplier_name: "Fornecedor A",
      invoice_number: "INV-A",
      bl_number: "BL-A",
      created_at: CREATED_EARLY,
      updated_at: CREATED_LATE,
      consignee: { id: "party-a", name: "Empresa A" },
      notify: { id: "party-a", name: "Empresa A" },
      invoice: INVOICE_PAYLOAD,
      bl: BL_PAYLOAD,
    });
    expect(detail.documents.map((document) => document.id)).toEqual([
      "doc-a",
      "doc-a-bl",
    ]);
  });

  it("não carrega o detalhe de importação de outro tenant", async () => {
    await expect(getImportDetail(TENANT_A, "import-b")).rejects.toBeInstanceOf(
      ImportNotFoundError,
    );
  });

  it("lista somente as empresas do tenant", async () => {
    const page = await listTenantParties(TENANT_A);

    expect(page.rows.map((party) => party.id)).toEqual(["party-a"]);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      name: "Empresa A",
      cnpj: "11.222.333/0001-81",
      address: {
        street: "Rua A",
        number: "100",
        city: "São Paulo",
        state: "SP",
        country: "Brasil",
      },
    });
  });

  it("busca a empresa do tenant pelo id", async () => {
    const party = await getPartyById(TENANT_A, "party-a");

    expect(party).toMatchObject({
      id: "party-a",
      name: "Empresa A",
      cnpj: "11.222.333/0001-81",
    });
  });

  it("rejeita empresa de outro tenant", async () => {
    await expect(getPartyById(TENANT_A, "party-b")).rejects.toBeInstanceOf(
      PartyNotFoundError,
    );
  });

  it("lista somente as NCMs do tenant", async () => {
    const page = await listTenantNcms(TENANT_A);

    expect(page.rows.map((ncm) => ncm.id)).toEqual(["ncm-a"]);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      code: "12345678",
      description: "Produto A",
    });
  });

  it("busca a NCM do tenant pelo id", async () => {
    const ncm = await getNcmById(TENANT_A, "ncm-a");

    expect(ncm).toMatchObject({
      id: "ncm-a",
      code: "12345678",
      description: "Produto A",
    });
  });

  it("rejeita NCM de outro tenant", async () => {
    await expect(getNcmById(TENANT_A, "ncm-b")).rejects.toBeInstanceOf(
      NcmNotFoundError,
    );
  });

  it("encontra o documento do tenant e da importação pelo sha256", async () => {
    const documents = await findDocumentsBySha256({
      tenantId: TENANT_A,
      importId: "import-a",
      sha256: SHA_INVOICE_A,
    });

    expect(documents).toEqual([
      { id: "doc-a", docType: "invoice", status: "extracted" },
    ]);
  });

  it("encontra somente os documentos do tenant pelo sha256", async () => {
    const documents = await findTenantDocumentsBySha256({
      tenantId: TENANT_A,
      sha256: SHA_INVOICE_A,
    });

    expect(documents).toEqual([
      {
        id: "doc-a",
        docType: "invoice",
        importId: "import-a",
        storagePath: "tenant-a/import-a/doc-a.pdf",
        filename: "doc-a.pdf",
        mediaType: "application/pdf",
        sizeBytes: 1024,
        status: "extracted",
        version: 1,
        createdAt: CREATED_EARLY,
      },
    ]);
  });

  it("lista somente os paths de storage do tenant e da importação", async () => {
    const paths = await listImportStoragePaths({
      tenantId: TENANT_A,
      importId: "import-a",
    });

    expect(paths.sort()).toEqual([
      "tenant-a/import-a/doc-a-bl.pdf",
      "tenant-a/import-a/doc-a.pdf",
    ]);
  });

  it("valida a posse do documento do próprio tenant", async () => {
    await expect(
      assertDocumentOwnership({ tenantId: TENANT_A, documentId: "doc-a" }),
    ).resolves.toBeUndefined();
  });

  it("rejeita a posse de documento de outro tenant", async () => {
    await expect(
      assertDocumentOwnership({ tenantId: TENANT_A, documentId: "doc-b" }),
    ).rejects.toThrow("Documento não pertence ao tenant");
  });

  it("retorna a extração mais recente por documento do tenant", async () => {
    const latest = await findLatestExtractionsByDocumentIds({
      tenantId: TENANT_A,
      documentIds: ["doc-a"],
    });

    expect(latest.size).toBe(1);
    expect(latest.get("doc-a")).toMatchObject({
      id: "extraction-a",
      documentId: "doc-a",
      model: "modelo-teste",
      payload: INVOICE_PAYLOAD,
      tokensUsed: 42,
      createdAt: CREATED_EARLY,
    });
  });
});
