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

describe("listTenantNcms", () => {
  it("lista somente as NCMs do tenant ordenadas por código", async () => {
    const ncms = await listTenantNcms("tenant-a");

    expect(ncms.map((ncm) => ncm.code)).toEqual(["12345678", "99999999"]);
    expect(ncms.map((ncm) => ncm.id)).toEqual(["ncm-a-1", "ncm-a-2"]);
    expect(ncms).not.toContainEqual(
      expect.objectContaining({ id: "ncm-b-1" }),
    );

    const query = admin.queries.find((entry) => entry.table === "ncms");
    expect(query?.filters).toContainEqual({
      column: "tenant_id",
      operator: "eq",
      value: "tenant-a",
    });
  });

  it("retorna lista vazia quando o tenant não possui NCMs", async () => {
    await expect(listTenantNcms("tenant-c")).resolves.toEqual([]);
  });

  it("propaga erro do banco ao listar", async () => {
    readClient.failNext({ message: "conexão indisponível" });

    await expect(listTenantNcms("tenant-a")).rejects.toThrow(
      "conexão indisponível",
    );
  });

  it("lista NCMs sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    const ncms = await listTenantNcms("tenant-a");

    expect(ncms.map((ncm) => ncm.id)).toEqual(["ncm-a-1", "ncm-a-2"]);
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
