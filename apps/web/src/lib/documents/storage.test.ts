import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildUniqueStoragePath,
  uploadImportFile,
} from "@/lib/documents/storage";
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

const storage = vi.hoisted(() => ({
  bucket: null as string | null,
  upload: vi.fn(),
}));

function documentSeed(params: {
  id: string;
  tenantId: string;
  importId: string;
  storagePath: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    import_id: params.importId,
    storage_path: params.storagePath,
  };
}

function makeAdmin(db: FakeSupabase) {
  return Object.assign(db, {
    storage: {
      from(bucket: string) {
        storage.bucket = bucket;
        return { upload: storage.upload };
      },
    },
  });
}

function seedAdmin(storagePaths: string[] = []): FakeSupabase {
  return new FakeSupabase({
    documents: storagePaths.map((storagePath, index) =>
      documentSeed({
        id: `doc-${index}`,
        tenantId: "tenant-a",
        importId: "import-1",
        storagePath,
      }),
    ),
  });
}

beforeEach(() => {
  storage.bucket = null;
  storage.upload.mockReset();
  storage.upload.mockResolvedValue({ data: { path: "ok" }, error: null });
  mocks.readClient = seedAdmin();
  mocks.adminClient = makeAdmin(seedAdmin());
  mocks.failAdminClient = false;
});

describe("buildUniqueStoragePath", () => {
  it("usa o caminho base quando não há colisão", async () => {
    mocks.readClient = seedAdmin();

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo.pdf");
  });

  it("adiciona o prefixo do digest quando o caminho exato já existe", async () => {
    mocks.readClient = seedAdmin(["tenant-a/import-1/arquivo.pdf"]);

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo-abcdef.pdf");
  });

  it("incrementa o sufixo quando o caminho com digest também existe", async () => {
    mocks.readClient = seedAdmin([
      "tenant-a/import-1/arquivo.pdf",
      "tenant-a/import-1/arquivo-abcdef.pdf",
    ]);

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo-abcdef-2.pdf");
  });

  it("continua incrementando até encontrar um caminho livre", async () => {
    mocks.readClient = seedAdmin([
      "tenant-a/import-1/arquivo.pdf",
      "tenant-a/import-1/arquivo-abcdef.pdf",
      "tenant-a/import-1/arquivo-abcdef-2.pdf",
    ]);

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo-abcdef-3.pdf");
  });

  it("sanitiza caracteres inválidos do filename", async () => {
    mocks.readClient = seedAdmin();

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "nota@fiscal#2026.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/nota_fiscal_2026.pdf");
  });

  it("preserva os caracteres permitidos no filename", async () => {
    mocks.readClient = seedAdmin();

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "relatorio (1)+v2.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/relatorio (1)+v2.pdf");
  });

  it("adiciona o sufixo ao final quando o arquivo não tem extensão", async () => {
    mocks.readClient = seedAdmin(["tenant-a/import-1/arquivo"]);

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo-abcdef");
  });

  it("ignora paths de outro tenant ao detectar colisão", async () => {
    const db = seedAdmin();
    db.rows("documents").push(
      documentSeed({
        id: "doc-outro-tenant",
        tenantId: "tenant-b",
        importId: "import-1",
        storagePath: "tenant-a/import-1/arquivo.pdf",
      }),
    );
    mocks.readClient = db;

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo.pdf");
  });

  it("resolve o caminho sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    await expect(
      buildUniqueStoragePath({
        tenantId: "tenant-a",
        importId: "import-1",
        filename: "arquivo.pdf",
        digest: "abcdef1234567890",
      }),
    ).resolves.toBe("tenant-a/import-1/arquivo.pdf");
  });
});

describe("uploadImportFile", () => {
  it("envia o arquivo ao bucket import-documents sem upsert", async () => {
    mocks.adminClient = makeAdmin(seedAdmin());
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await expect(
      uploadImportFile({
        storagePath: "tenant-a/import-1/arquivo.pdf",
        bytes,
        mediaType: "application/pdf",
      }),
    ).resolves.toBeUndefined();

    expect(storage.bucket).toBe("import-documents");
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledWith(
      "tenant-a/import-1/arquivo.pdf",
      bytes,
      { contentType: "application/pdf", upsert: false },
    );
  });

  it("propaga a mensagem de erro do Storage", async () => {
    mocks.adminClient = makeAdmin(seedAdmin());
    storage.upload.mockResolvedValue({
      data: null,
      error: { message: "bucket indisponível" },
    });

    await expect(
      uploadImportFile({
        storagePath: "tenant-a/import-1/arquivo.pdf",
        bytes: new Uint8Array([1]),
        mediaType: "application/pdf",
      }),
    ).rejects.toThrow("bucket indisponível");
  });

  it("usa mensagem padrão quando o Storage retorna erro sem mensagem", async () => {
    mocks.adminClient = makeAdmin(seedAdmin());
    storage.upload.mockResolvedValue({
      data: null,
      error: { message: "" },
    });

    await expect(
      uploadImportFile({
        storagePath: "tenant-a/import-1/arquivo.pdf",
        bytes: new Uint8Array([1]),
        mediaType: "application/pdf",
      }),
    ).rejects.toThrow("Falha ao enviar arquivo ao Storage");
  });
});
