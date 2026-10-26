import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDefaultConsignee,
  getDefaultConsigneeSnapshot,
  listTenantPartyOptions,
  setDefaultConsignee,
} from "@/lib/documents/consignee-settings";
import { formatCnpj, type PartyAddress } from "@/lib/documents/parties-shared";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  readClient: undefined as unknown,
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.readClient,
}));

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const CNPJ_A = "11222333000181";
const CNPJ_B = "44555666000174";

function partySeed(params: {
  id: string;
  tenantId: string;
  name: string;
  cnpjDigits: string;
  address?: Partial<PartyAddress>;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    name: params.name,
    cnpj: formatCnpj(params.cnpjDigits),
    cnpj_digits: params.cnpjDigits,
    address: "",
    street: params.address?.street ?? "Rua Padrão",
    street_number: params.address?.number ?? "100",
    complement: params.address?.complement ?? null,
    postal_code: params.address?.postalCode ?? "01310-100",
    city: params.address?.city ?? "São Paulo",
    state: params.address?.state ?? "SP",
    country: params.address?.country ?? "Brasil",
    other_info: params.address?.other ?? null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function settingsSeed(params: {
  tenantId: string;
  defaultConsigneePartyId?: string | null;
}): FakeRow {
  return {
    tenant_id: params.tenantId,
    ai_overrides: {},
    confidence_threshold: 0.8,
    validation_rules: {},
    default_consignee_party_id: params.defaultConsigneePartyId ?? null,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function seed(params: { defaultConsigneePartyId?: string | null } = {}): FakeSupabase {
  return new FakeSupabase({
    parties: [
      partySeed({
        id: "party-a-default",
        tenantId: TENANT_A,
        name: "Consignatário Padrão",
        cnpjDigits: CNPJ_A,
      }),
      partySeed({
        id: "party-a-late",
        tenantId: TENANT_A,
        name: "Zeta Comércio",
        cnpjDigits: "99888777000166",
      }),
      partySeed({
        id: "party-b",
        tenantId: TENANT_B,
        name: "Beta Exterior",
        cnpjDigits: CNPJ_B,
      }),
    ],
    tenant_settings: [
      settingsSeed({
        tenantId: TENANT_A,
        defaultConsigneePartyId: params.defaultConsigneePartyId,
      }),
      settingsSeed({ tenantId: TENANT_B }),
    ],
  });
}

let readClient: FakeSupabase;

beforeEach(() => {
  readClient = seed();
  mocks.readClient = readClient;
});

describe("getDefaultConsignee", () => {
  it("devolve null quando o tenant não tem linha de configurações", async () => {
    mocks.readClient = new FakeSupabase({});

    await expect(getDefaultConsignee(TENANT_A)).resolves.toBeNull();
  });

  it("devolve null quando o consignee padrão não está configurado", async () => {
    await expect(getDefaultConsignee(TENANT_A)).resolves.toBeNull();
  });

  it("devolve a party configurada com nome, CNPJ e endereço", async () => {
    mocks.readClient = seed({ defaultConsigneePartyId: "party-a-default" });

    await expect(getDefaultConsignee(TENANT_A)).resolves.toEqual({
      id: "party-a-default",
      name: "Consignatário Padrão",
      cnpj: formatCnpj(CNPJ_A),
      address: {
        street: "Rua Padrão",
        number: "100",
        complement: null,
        postalCode: "01310-100",
        city: "São Paulo",
        state: "SP",
        country: "Brasil",
        other: null,
      },
    });
  });

  it("devolve null quando a party configurada não existe mais", async () => {
    mocks.readClient = seed({
      defaultConsigneePartyId: "party-removida",
    });

    await expect(getDefaultConsignee(TENANT_A)).resolves.toBeNull();
  });

  it("devolve null quando a party configurada é de outro tenant", async () => {
    mocks.readClient = seed({ defaultConsigneePartyId: "party-b" });

    await expect(getDefaultConsignee(TENANT_A)).resolves.toBeNull();
  });

  it("propaga erro ao ler as configurações do tenant", async () => {
    readClient.failNext(
      { message: "falha ao ler configurações" },
      { table: "tenant_settings", operation: "select" },
    );

    await expect(getDefaultConsignee(TENANT_A)).rejects.toThrow(
      "falha ao ler configurações",
    );
  });

  it("propaga erro ao buscar a party padrão", async () => {
    mocks.readClient = seed({ defaultConsigneePartyId: "party-a-default" });
    (mocks.readClient as FakeSupabase).failNext(
      { message: "falha ao buscar party" },
      { table: "parties", operation: "select" },
    );

    await expect(getDefaultConsignee(TENANT_A)).rejects.toThrow(
      "falha ao buscar party",
    );
  });

  it("getDefaultConsigneeSnapshot devolve o mesmo valor", async () => {
    mocks.readClient = seed({ defaultConsigneePartyId: "party-a-default" });

    const snapshot = await getDefaultConsigneeSnapshot(TENANT_A);

    expect(snapshot).toMatchObject({
      id: "party-a-default",
      name: "Consignatário Padrão",
      cnpj: formatCnpj(CNPJ_A),
    });
  });
});

describe("setDefaultConsignee", () => {
  it("grava a party padrão do tenant", async () => {
    await setDefaultConsignee(TENANT_A, "party-a-default");

    expect(readClient.rows("tenant_settings")[0]).toMatchObject({
      tenant_id: TENANT_A,
      default_consignee_party_id: "party-a-default",
    });
    expect(readClient.rows("tenant_settings")[1]).toMatchObject({
      tenant_id: TENANT_B,
      default_consignee_party_id: null,
    });
  });

  it("limpa o padrão com null", async () => {
    mocks.readClient = seed({ defaultConsigneePartyId: "party-a-default" });

    await setDefaultConsignee(TENANT_A, null);

    expect(
      (mocks.readClient as FakeSupabase).rows("tenant_settings")[0]
        ?.default_consignee_party_id,
    ).toBeNull();
  });

  it("lança quando o tenant não tem linha de configurações", async () => {
    mocks.readClient = new FakeSupabase({});

    await expect(
      setDefaultConsignee(TENANT_A, "party-a-default"),
    ).rejects.toThrow("Configurações do tenant não encontradas");
  });

  it("propaga erro do banco", async () => {
    readClient.failNext(
      { message: "falha ao salvar" },
      { table: "tenant_settings", operation: "update" },
    );

    await expect(
      setDefaultConsignee(TENANT_A, "party-a-default"),
    ).rejects.toThrow("falha ao salvar");
  });
});

describe("listTenantPartyOptions", () => {
  it("lista as empresas do tenant ordenadas por nome", async () => {
    await expect(listTenantPartyOptions(TENANT_A)).resolves.toEqual([
      { id: "party-a-default", name: "Consignatário Padrão", cnpj: formatCnpj(CNPJ_A) },
      { id: "party-a-late", name: "Zeta Comércio", cnpj: "99.888.777/0001-66" },
    ]);
  });

  it("limita a lista a 200 empresas", async () => {
    mocks.readClient = new FakeSupabase({
      parties: Array.from({ length: 205 }, (_, index) =>
        partySeed({
          id: `party-${index}`,
          tenantId: TENANT_A,
          name: `Empresa ${String(index).padStart(3, "0")}`,
          cnpjDigits: `${String(index).padStart(14, "0")}`,
        }),
      ),
    });

    const options = await listTenantPartyOptions(TENANT_A);

    expect(options).toHaveLength(200);
    expect(options[0]?.name).toBe("Empresa 000");
    expect(options[199]?.name).toBe("Empresa 199");
  });

  it("propaga erro do banco", async () => {
    readClient.failNext(
      { message: "falha ao listar empresas" },
      { table: "parties", operation: "select" },
    );

    await expect(listTenantPartyOptions(TENANT_A)).rejects.toThrow(
      "falha ao listar empresas",
    );
  });
});
