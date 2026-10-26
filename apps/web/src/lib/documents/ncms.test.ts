import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNcm,
  getNcmById,
  listTenantNcms,
  NcmNotFoundError,
  NcmValidationError,
  updateNcm,
} from "@/lib/documents/ncms";
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

function ncmSeed(params: {
  id: string;
  tenantId: string;
  code: string;
  description?: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    code: params.code,
    description: params.description ?? `NCM ${params.code}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function seedAdmin(): FakeSupabase {
  return new FakeSupabase({
    ncms: [
      ncmSeed({ id: "ncm-a-2", tenantId: "tenant-a", code: "99999999" }),
      ncmSeed({ id: "ncm-a-1", tenantId: "tenant-a", code: "12345678" }),
      ncmSeed({ id: "ncm-b-1", tenantId: "tenant-b", code: "00000000" }),
    ],
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

function validPayload(overrides: { code?: string; description?: string } = {}) {
  return {
    code: overrides.code ?? "1234.56.78",
    description: overrides.description ?? "  Aparelhos elétricos  ",
  };
}

function seedPagination(): FakeSupabase {
  return new FakeSupabase({
    ncms: [
      ncmSeed({
        id: "ncm-p-1",
        tenantId: "tenant-a",
        code: "10000001",
        description: "Soja em grãos",
      }),
      ncmSeed({
        id: "ncm-p-2",
        tenantId: "tenant-a",
        code: "10000002",
        description: "Milho em grãos",
      }),
      ncmSeed({
        id: "ncm-p-3",
        tenantId: "tenant-a",
        code: "10000003",
        description: "Café torrado",
      }),
      ncmSeed({
        id: "ncm-p-4",
        tenantId: "tenant-a",
        code: "10000004",
        description: "Açúcar refinado",
      }),
      ncmSeed({
        id: "ncm-p-5",
        tenantId: "tenant-a",
        code: "10000005",
        description: "Algodão em pluma",
      }),
      ncmSeed({
        id: "ncm-p-6",
        tenantId: "tenant-a",
        code: "10000006",
        description: "Café 100% solúvel",
      }),
      ncmSeed({
        id: "ncm-p-7",
        tenantId: "tenant-a",
        code: "10000007",
        description: "Café 100X solúvel",
      }),
      ncmSeed({
        id: "ncm-p-b",
        tenantId: "tenant-b",
        code: "10000000",
        description: "Soja em grãos",
      }),
    ],
  });
}

describe("listTenantNcms", () => {
  it("lista somente as NCMs do tenant ordenadas por código", async () => {
    const page = await listTenantNcms("tenant-a");

    expect(page.rows.map((ncm) => ncm.code)).toEqual(["12345678", "99999999"]);
    expect(page.rows.map((ncm) => ncm.id)).toEqual(["ncm-a-1", "ncm-a-2"]);
    expect(page.rows).not.toContainEqual(
      expect.objectContaining({ id: "ncm-b-1" }),
    );
    expect(page.total).toBe(2);

    const query = admin.queries.find((entry) => entry.table === "ncms");
    expect(query?.filters).toContainEqual({
      column: "tenant_id",
      operator: "eq",
      value: "tenant-a",
    });
  });

  it("pagina por padrão em 1 com 20 itens e total global", async () => {
    mocks.readClient = seedPagination();

    const page = await listTenantNcms("tenant-a");

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.rows).toHaveLength(7);
    expect(page.total).toBe(7);
    expect(page.totalPages).toBe(1);
  });

  it("devolve a página e o tamanho solicitados mantendo o total global", async () => {
    mocks.readClient = seedPagination();

    const page = await listTenantNcms("tenant-a", { page: 2, pageSize: 5 });

    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(5);
    expect(page.total).toBe(7);
    expect(page.totalPages).toBe(2);
    expect(page.rows.map((ncm) => ncm.code)).toEqual([
      "10000006",
      "10000007",
    ]);
  });

  it("busca por descrição sem diferenciar maiúsculas e minúsculas", async () => {
    mocks.readClient = seedPagination();

    const page = await listTenantNcms("tenant-a", { search: "  CAFÉ  " });

    expect(page.total).toBe(3);
    expect(page.rows.map((ncm) => ncm.id)).toEqual([
      "ncm-p-3",
      "ncm-p-6",
      "ncm-p-7",
    ]);
  });

  it("busca também pelo código", async () => {
    mocks.readClient = seedPagination();

    const page = await listTenantNcms("tenant-a", { search: "10000006" });

    expect(page.rows.map((ncm) => ncm.id)).toEqual(["ncm-p-6"]);
    expect(page.total).toBe(1);
  });

  it("escapa % e _ para que a busca trate os caracteres como literais", async () => {
    mocks.readClient = seedPagination();

    const percent = await listTenantNcms("tenant-a", { search: "100%" });
    expect(percent.rows.map((ncm) => ncm.id)).toEqual(["ncm-p-6"]);

    const underscore = await listTenantNcms("tenant-a", { search: "café_100" });
    expect(underscore.rows).toHaveLength(0);
    expect(underscore.total).toBe(0);
  });

  it("isola o total por tenant mesmo com busca", async () => {
    mocks.readClient = seedPagination();

    const page = await listTenantNcms("tenant-a", { search: "soja" });

    expect(page.rows.map((ncm) => ncm.id)).toEqual(["ncm-p-1"]);
    expect(page.total).toBe(1);
  });

  it("retorna página vazia quando o tenant não possui NCMs", async () => {
    const page = await listTenantNcms("tenant-c");

    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(1);
  });

  it("propaga erro do banco ao listar", async () => {
    readClient.failNext({ message: "conexão indisponível" });

    await expect(listTenantNcms("tenant-a")).rejects.toThrow(
      "conexão indisponível",
    );
  });

  it("lista NCMs sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    const page = await listTenantNcms("tenant-a");

    expect(page.rows.map((ncm) => ncm.id)).toEqual(["ncm-a-1", "ncm-a-2"]);
  });
});

describe("getNcmById", () => {
  it("busca a NCM do próprio tenant", async () => {
    await expect(getNcmById("tenant-a", "ncm-a-1")).resolves.toMatchObject({
      id: "ncm-a-1",
      code: "12345678",
      description: "NCM 12345678",
    });
  });

  it("lança NcmNotFoundError para NCM de outro tenant", async () => {
    await expect(getNcmById("tenant-a", "ncm-b-1")).rejects.toBeInstanceOf(
      NcmNotFoundError,
    );
  });

  it("lança NcmNotFoundError para id inexistente", async () => {
    await expect(getNcmById("tenant-a", "ncm-inexistente")).rejects.toThrow(
      "NCM não encontrada",
    );
  });
});

describe("createNcm", () => {
  it("normaliza o código, remove espaços da descrição e grava o tenant_id", async () => {
    const ncm = await createNcm("tenant-a", validPayload());

    expect(ncm).toMatchObject({
      code: "12345678",
      description: "Aparelhos elétricos",
    });

    const stored = findRow("ncms", String(ncm.id));
    expect(stored).toMatchObject({
      tenant_id: "tenant-a",
      code: "12345678",
      description: "Aparelhos elétricos",
    });
  });

  it("rejeita código com menos de 4 dígitos", async () => {
    await expect(
      createNcm("tenant-a", validPayload({ code: "123" })),
    ).rejects.toBeInstanceOf(NcmValidationError);
  });

  it("rejeita código com mais de 10 dígitos", async () => {
    await expect(
      createNcm("tenant-a", validPayload({ code: "12345678901" })),
    ).rejects.toThrow("Código NCM deve ter entre 4 e 10 dígitos");
  });

  it("rejeita descrição vazia", async () => {
    await expect(
      createNcm("tenant-a", validPayload({ description: "   " })),
    ).rejects.toThrow("Descrição é obrigatória");
  });

  it("converte violação de unicidade (23505) em NcmValidationError", async () => {
    adminClient.failNext({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });

    await expect(
      createNcm("tenant-a", validPayload({ code: "99999999" })),
    ).rejects.toThrow("Já existe uma NCM com este código");
  });

  it("não insere a NCM quando o banco retorna erro genérico", async () => {
    adminClient.failNext({ message: "falha ao inserir" });
    const before = admin.rows("ncms").length;

    await expect(createNcm("tenant-a", validPayload())).rejects.toThrow(
      "falha ao inserir",
    );
    expect(admin.rows("ncms")).toHaveLength(before);
  });
});

describe("updateNcm", () => {
  it("atualiza somente a NCM do tenant informado", async () => {
    const ncm = await updateNcm("tenant-a", "ncm-a-1", {
      code: "9876.54.32",
      description: "  Descrição atualizada  ",
    });

    expect(ncm).toMatchObject({
      id: "ncm-a-1",
      code: "98765432",
      description: "Descrição atualizada",
    });
    expect(findRow("ncms", "ncm-a-1")).toMatchObject({
      code: "98765432",
      description: "Descrição atualizada",
    });
    expect(findRow("ncms", "ncm-b-1")).toMatchObject({
      code: "00000000",
      description: "NCM 00000000",
    });
  });

  it("não atualiza NCM de outro tenant e lança NcmNotFoundError", async () => {
    await expect(
      updateNcm("tenant-a", "ncm-b-1", {
        code: "11111111",
        description: "Tentativa cross-tenant",
      }),
    ).rejects.toBeInstanceOf(NcmNotFoundError);

    expect(findRow("ncms", "ncm-b-1")).toMatchObject({
      code: "00000000",
      description: "NCM 00000000",
    });
  });

  it("rejeita payload inválido antes de consultar o banco", async () => {
    await expect(
      updateNcm("tenant-a", "ncm-a-1", {
        code: "12",
        description: "Descrição",
      }),
    ).rejects.toBeInstanceOf(NcmValidationError);

    expect(admin.queries).toHaveLength(0);
  });

  it("converte violação de unicidade (23505) em NcmValidationError", async () => {
    adminClient.failNext({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });

    await expect(
      updateNcm("tenant-a", "ncm-a-1", {
        code: "99999999",
        description: "Duplicada",
      }),
    ).rejects.toThrow("Já existe uma NCM com este código");
  });

  it("lança NcmNotFoundError quando a NCM não existe", async () => {
    await expect(
      updateNcm("tenant-a", "ncm-inexistente", validPayload()),
    ).rejects.toBeInstanceOf(NcmNotFoundError);
  });
});
