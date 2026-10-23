import { beforeEach, describe, expect, it, vi } from "vitest";

import { findTenantDocumentsBySha256 } from "@/lib/documents/documents";
import { findLatestExtractionsByDocumentIds } from "@/lib/documents/extractions";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

function documentSeed(params: {
  id: string;
  tenantId: string;
  importId?: string;
  docType?: string;
  storagePath?: string;
  sha256: string;
  status?: string;
  version?: number;
  originalFilename?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    import_id: params.importId ?? "import-1",
    doc_type: params.docType ?? "invoice",
    storage_path: params.storagePath ?? `storage/${params.id}.pdf`,
    sha256: params.sha256,
    status: params.status ?? "pending",
    version: params.version ?? 1,
    original_filename:
      params.originalFilename === undefined
        ? `${params.id}.pdf`
        : params.originalFilename,
    content_type:
      params.contentType === undefined ? "application/pdf" : params.contentType,
    size_bytes: params.sizeBytes === undefined ? 1000 : params.sizeBytes,
    created_at: params.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function extractionSeed(params: {
  id: string;
  tenantId: string;
  documentId: string;
  model?: string;
  payload?: unknown;
  tokensUsed?: number | null;
  createdAt: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    document_id: params.documentId,
    model: params.model ?? "modelo-teste",
    payload: params.payload ?? {},
    tokens_used: params.tokensUsed === undefined ? 10 : params.tokensUsed,
    created_at: params.createdAt,
  };
}

function seedAdmin(): FakeSupabase {
  return new FakeSupabase({
    documents: [
      documentSeed({
        id: "doc-a-antigo",
        tenantId: "tenant-a",
        sha256: "sha-compartilhada",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      documentSeed({
        id: "doc-a-novo",
        tenantId: "tenant-a",
        sha256: "sha-compartilhada",
        docType: "packing_list",
        storagePath: "tenant-a/novo.pdf",
        status: "extracted",
        version: 2,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      documentSeed({
        id: "doc-b-mesma-sha",
        tenantId: "tenant-b",
        sha256: "sha-compartilhada",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
      documentSeed({
        id: "doc-a-sem-metadados",
        tenantId: "tenant-a",
        sha256: "sha-sem-metadados",
        originalFilename: null,
        contentType: null,
        sizeBytes: null,
      }),
    ],
    extraction_results: [
      extractionSeed({
        id: "extracao-a-antiga",
        tenantId: "tenant-a",
        documentId: "doc-a-antigo",
        payload: { versao: "antiga" },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      extractionSeed({
        id: "extracao-a-nova",
        tenantId: "tenant-a",
        documentId: "doc-a-antigo",
        model: "modelo-novo",
        payload: { versao: "nova" },
        tokensUsed: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      extractionSeed({
        id: "extracao-b-recente",
        tenantId: "tenant-b",
        documentId: "doc-a-antigo",
        payload: { versao: "outro-tenant" },
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
      extractionSeed({
        id: "extracao-a-novo",
        tenantId: "tenant-a",
        documentId: "doc-a-novo",
        payload: { versao: "unica" },
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      extractionSeed({
        id: "extracao-b-doc",
        tenantId: "tenant-b",
        documentId: "doc-b-mesma-sha",
        payload: { versao: "tenant-b" },
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ],
  });
}

let admin: FakeSupabase;

beforeEach(() => {
  admin = seedAdmin();
  mocks.admin = admin;
});

describe("findTenantDocumentsBySha256", () => {
  it("retorna somente os documentos do tenant informado", async () => {
    const documents = await findTenantDocumentsBySha256({
      tenantId: "tenant-a",
      sha256: "sha-compartilhada",
    });

    expect(documents.map((document) => document.id)).toEqual([
      "doc-a-novo",
      "doc-a-antigo",
    ]);
  });

  it("não vaza documento de outro tenant com a mesma sha256", async () => {
    const documents = await findTenantDocumentsBySha256({
      tenantId: "tenant-a",
      sha256: "sha-compartilhada",
    });

    expect(documents).not.toContainEqual(
      expect.objectContaining({ id: "doc-b-mesma-sha" }),
    );
  });

  it("ordena por created_at decrescente", async () => {
    const documents = await findTenantDocumentsBySha256({
      tenantId: "tenant-a",
      sha256: "sha-compartilhada",
    });

    const createdAt = documents.map((document) => document.createdAt);
    expect(createdAt).toEqual([...createdAt].sort().reverse());
  });

  it("mapeia as colunas do documento", async () => {
    const documents = await findTenantDocumentsBySha256({
      tenantId: "tenant-a",
      sha256: "sha-compartilhada",
    });

    expect(documents[0]).toEqual({
      id: "doc-a-novo",
      docType: "packing_list",
      importId: "import-1",
      storagePath: "tenant-a/novo.pdf",
      filename: "doc-a-novo.pdf",
      mediaType: "application/pdf",
      sizeBytes: 1000,
      status: "extracted",
      version: 2,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("aplica fallbacks quando filename, content_type e size_bytes são nulos", async () => {
    const documents = await findTenantDocumentsBySha256({
      tenantId: "tenant-a",
      sha256: "sha-sem-metadados",
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      id: "doc-a-sem-metadados",
      filename: "documento",
      mediaType: "application/octet-stream",
      sizeBytes: 0,
    });
  });

  it("retorna lista vazia quando o tenant não possui a sha256", async () => {
    await expect(
      findTenantDocumentsBySha256({
        tenantId: "tenant-c",
        sha256: "sha-compartilhada",
      }),
    ).resolves.toEqual([]);
  });

  it("propaga erro do banco", async () => {
    admin.failNext({ message: "conexão indisponível" });

    await expect(
      findTenantDocumentsBySha256({
        tenantId: "tenant-a",
        sha256: "sha-compartilhada",
      }),
    ).rejects.toThrow("conexão indisponível");
  });
});

describe("findLatestExtractionsByDocumentIds", () => {
  it("retorna Map vazio sem consultar o banco quando a lista está vazia", async () => {
    const latest = await findLatestExtractionsByDocumentIds({
      tenantId: "tenant-a",
      documentIds: [],
    });

    expect(latest.size).toBe(0);
    expect(admin.queries).toEqual([]);
  });

  it("retorna a extração mais recente de cada documento", async () => {
    const latest = await findLatestExtractionsByDocumentIds({
      tenantId: "tenant-a",
      documentIds: ["doc-a-antigo", "doc-a-novo"],
    });

    expect(latest.get("doc-a-antigo")).toEqual({
      id: "extracao-a-nova",
      documentId: "doc-a-antigo",
      model: "modelo-novo",
      payload: { versao: "nova" },
      tokensUsed: null,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    expect(latest.get("doc-a-novo")).toMatchObject({
      id: "extracao-a-novo",
      payload: { versao: "unica" },
    });
  });

  it("ignora extração de outro tenant para o mesmo documento", async () => {
    const latest = await findLatestExtractionsByDocumentIds({
      tenantId: "tenant-a",
      documentIds: ["doc-a-antigo"],
    });

    expect(latest.get("doc-a-antigo")?.id).toBe("extracao-a-nova");
    expect(latest.get("doc-a-antigo")?.payload).toEqual({ versao: "nova" });
  });

  it("não inclui documento sem extração no Map", async () => {
    const latest = await findLatestExtractionsByDocumentIds({
      tenantId: "tenant-a",
      documentIds: ["doc-a-antigo", "doc-sem-extracao"],
    });

    expect(latest.has("doc-sem-extracao")).toBe(false);
    expect(latest.size).toBe(1);
  });

  it("propaga erro do banco", async () => {
    admin.failNext({ message: "falha ao buscar extrações" });

    await expect(
      findLatestExtractionsByDocumentIds({
        tenantId: "tenant-a",
        documentIds: ["doc-a-antigo"],
      }),
    ).rejects.toThrow("falha ao buscar extrações");
  });
});
