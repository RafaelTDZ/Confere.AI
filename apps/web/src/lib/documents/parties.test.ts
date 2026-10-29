import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlExtraction,
  InvoiceExtraction,
  InvoiceParty,
} from "@/lib/ai/schemas";
import {
  combinePendingParties,
  deleteParty,
  getImportPartiesState,
  getPartyById,
  ImportNotFoundError,
  listTenantParties,
  PartyNotFoundError,
  PartyValidationError,
  pendingPartiesFromBl,
  pendingPartiesFromInvoice,
  registerImportParties,
  resolveBlParties,
  resolveInvoiceParties,
  updateParty,
} from "@/lib/documents/parties";
import {
  EMPTY_PARTY_ADDRESS,
  formatCnpj,
  type PartyAddress,
  type PartyRole,
  type PendingParty,
} from "@/lib/documents/parties-shared";
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

const CNPJ_EXISTENTE = "11222333000181";
const CNPJ_OUTRO_TENANT = "22333444000192";
const CNPJ_NOVO_NOTIFY = "33444555000163";
const CNPJ_NOVO_CONSIGNEE = "44555666000174";
const CNPJ_NOVO = "55666777000185";
const CNPJ_OUTRA_EMPRESA = "99888777000166";
const CNPJ_DEFAULT = "66777888000190";

function address(overrides: Partial<PartyAddress> = {}): PartyAddress {
  return { ...EMPTY_PARTY_ADDRESS, ...overrides };
}

function makeParty(overrides: Partial<InvoiceParty> = {}): InvoiceParty {
  return {
    name: null,
    cnpj: null,
    address: address(),
    ...overrides,
  };
}

function makeInvoice(
  overrides: Partial<InvoiceExtraction> = {},
): InvoiceExtraction {
  return {
    number: "INV-001",
    blNumber: null,
    exporter: { name: "Exporter Ltd" },
    importer: makeParty(),
    notify: makeParty(),
    products: [],
    ...overrides,
  };
}

function makeBl(overrides: Partial<BlExtraction> = {}): BlExtraction {
  return {
    number: "BL-001",
    shipper: "Exporter Ltd",
    consignee: null,
    consigneeDetails: makeParty(),
    notifyParty: null,
    notifyPartyDetails: makeParty(),
    ...overrides,
  } as unknown as BlExtraction;
}

function pendingParty(overrides: Partial<PendingParty> = {}): PendingParty {
  return {
    roles: ["consignee"],
    name: "Empresa",
    cnpj: CNPJ_NOVO,
    address: address(),
    ...overrides,
  };
}

function partySeed(params: {
  id: string;
  tenantId: string;
  name: string;
  cnpjDigits: string;
  address?: Partial<PartyAddress>;
}): FakeRow {
  const addr = address({
    street: "Rua Padrão",
    number: "100",
    city: "São Paulo",
    state: "SP",
    country: "Brasil",
    ...params.address,
  });
  return {
    id: params.id,
    tenant_id: params.tenantId,
    name: params.name,
    cnpj: formatCnpj(params.cnpjDigits),
    cnpj_digits: params.cnpjDigits,
    address: "",
    street: addr.street,
    street_number: addr.number,
    complement: addr.complement,
    postal_code: addr.postalCode,
    city: addr.city,
    state: addr.state,
    country: addr.country,
    other_info: addr.other,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function importSeed(params: {
  id: string;
  tenantId: string;
  consigneeId?: string | null;
  notifyId?: string | null;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    consignee_id: params.consigneeId ?? null,
    notify_id: params.notifyId ?? null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function documentSeed(params: {
  id: string;
  tenantId: string;
  importId: string;
  docType: string;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: params.tenantId,
    import_id: params.importId,
    doc_type: params.docType,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function extractionSeed(params: {
  id: string;
  documentId: string;
  payload: unknown;
}): FakeRow {
  return {
    id: params.id,
    tenant_id: "tenant-a",
    document_id: params.documentId,
    payload: params.payload,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

const invoiceComExistente = makeInvoice({
  importer: makeParty({
    name: "Alfa Importadora",
    cnpj: CNPJ_EXISTENTE,
    address: address({ street: "Rua A", city: "São Paulo" }),
  }),
  notify: makeParty({
    name: "Novo Notify",
    cnpj: CNPJ_NOVO_NOTIFY,
    address: address({ street: "Rua C", city: "Curitiba", state: "PR" }),
  }),
});

const blComExistente = makeBl({
  consignee: "Consignatário Fallback",
  consigneeDetails: makeParty({
    name: "Novo Consignatário",
    cnpj: CNPJ_NOVO_CONSIGNEE,
    address: address({ street: "Rua D" }),
  }),
  notifyParty: "Notify Fallback",
  notifyPartyDetails: makeParty({
    name: "Alfa Importadora",
    cnpj: CNPJ_EXISTENTE,
    address: address({ street: "Rua A" }),
  }),
});

function seedAdmin(): FakeSupabase {
  return new FakeSupabase({
    parties: [
      partySeed({
        id: "party-a",
        tenantId: "tenant-a",
        name: "Alfa Importadora",
        cnpjDigits: CNPJ_EXISTENTE,
        address: { street: "Rua A", city: "São Paulo" },
      }),
      partySeed({
        id: "party-a-late",
        tenantId: "tenant-a",
        name: "Zeta Comércio",
        cnpjDigits: CNPJ_OUTRA_EMPRESA,
      }),
      partySeed({
        id: "party-b",
        tenantId: "tenant-b",
        name: "Beta Exterior",
        cnpjDigits: CNPJ_OUTRO_TENANT,
      }),
    ],
    imports: [
      importSeed({ id: "import-a", tenantId: "tenant-a" }),
      importSeed({ id: "import-empty", tenantId: "tenant-a" }),
      importSeed({ id: "import-invoice", tenantId: "tenant-a" }),
      importSeed({ id: "import-bl", tenantId: "tenant-a" }),
      importSeed({ id: "import-b", tenantId: "tenant-b" }),
    ],
    documents: [
      documentSeed({
        id: "doc-invoice",
        tenantId: "tenant-a",
        importId: "import-invoice",
        docType: "invoice",
      }),
      documentSeed({
        id: "doc-bl",
        tenantId: "tenant-a",
        importId: "import-bl",
        docType: "bill_of_lading",
      }),
      documentSeed({
        id: "doc-b-invoice",
        tenantId: "tenant-b",
        importId: "import-b",
        docType: "invoice",
      }),
    ],
    extraction_results: [
      extractionSeed({
        id: "ext-invoice",
        documentId: "doc-invoice",
        payload: invoiceComExistente,
      }),
      extractionSeed({
        id: "ext-bl",
        documentId: "doc-bl",
        payload: blComExistente,
      }),
      extractionSeed({
        id: "ext-b-invoice",
        documentId: "doc-b-invoice",
        payload: makeInvoice({
          importer: makeParty({
            name: "Beta Exterior",
            cnpj: CNPJ_OUTRO_TENANT,
          }),
        }),
      }),
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

function findImport(id: string): FakeRow {
  return findRow("imports", id);
}

function configureDefaultConsignee(partyId = "party-default"): void {
  admin.rows("parties").push(
    partySeed({
      id: "party-default",
      tenantId: "tenant-a",
      name: "Consignatário Padrão",
      cnpjDigits: CNPJ_DEFAULT,
      address: {
        street: "Rua Padrão",
        number: "500",
        city: "Campinas",
        state: "SP",
        country: "Brasil",
      },
    }),
  );
  admin.rows("tenant_settings").push({
    tenant_id: "tenant-a",
    default_consignee_party_id: partyId,
    ai_overrides: {},
    confidence_threshold: 0.8,
    validation_rules: {},
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

function partiesWithCnpj(digits: string): FakeRow[] {
  return admin.rows("parties").filter((row) => row.cnpj_digits === digits);
}

describe("combinePendingParties", () => {
  it("agrupa por CNPJ válido e une papéis sem duplicar", () => {
    const combined = combinePendingParties([
      pendingParty({
        roles: ["consignee"],
        name: null,
        cnpj: formatCnpj(CNPJ_EXISTENTE),
        address: address({ street: "Rua A" }),
      }),
      pendingParty({
        roles: ["notify", "consignee"],
        name: "Alfa Importadora",
        cnpj: CNPJ_EXISTENTE,
        address: address({ city: "São Paulo", country: "Brasil" }),
      }),
    ]);

    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({
      roles: ["consignee", "notify"],
      name: "Alfa Importadora",
      cnpj: formatCnpj(CNPJ_EXISTENTE),
      address: {
        street: "Rua A",
        city: "São Paulo",
        country: "Brasil",
      },
    });
  });

  it("preenche apenas os campos faltantes e mantém o nome já preenchido", () => {
    const combined = combinePendingParties([
      pendingParty({
        name: "Nome Original",
        cnpj: CNPJ_EXISTENTE,
        address: address({ street: "Rua A" }),
      }),
      pendingParty({
        name: "Nome Conflitante",
        cnpj: CNPJ_EXISTENTE,
        address: address({ street: "Rua B", complement: "Sala 2" }),
      }),
    ]);

    expect(combined[0]).toMatchObject({
      name: "Nome Original",
      address: { street: "Rua A", complement: "Sala 2" },
    });
  });

  it("mantém separadas as entradas sem CNPJ válido", () => {
    const combined = combinePendingParties([
      pendingParty({ roles: ["consignee"], name: "Sem CNPJ", cnpj: null }),
      pendingParty({ roles: ["notify"], name: "CNPJ curto", cnpj: "123" }),
    ]);

    expect(combined).toHaveLength(2);
    expect(combined.map((party) => party.name)).toEqual([
      "Sem CNPJ",
      "CNPJ curto",
    ]);
    expect(combined.map((party) => party.roles)).toEqual([
      ["consignee"],
      ["notify"],
    ]);
  });
});

describe("pendingPartiesFromInvoice", () => {
  it("mapeia importer para consignee e notify para notify", () => {
    const pending = pendingPartiesFromInvoice(
      makeInvoice({
        importer: makeParty({
          name: "  Importador  ",
          cnpj: " 11.222.333/0001-81 ",
          address: address({ city: "São Paulo" }),
        }),
        notify: makeParty({
          name: "Notify",
          cnpj: "22.333.444/0001-92",
          address: address({ city: "Santos" }),
        }),
      }),
    );

    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({
      roles: ["consignee"],
      name: "Importador",
      cnpj: "11.222.333/0001-81",
      address: { city: "São Paulo" },
    });
    expect(pending[1]).toMatchObject({
      roles: ["notify"],
      name: "Notify",
      cnpj: "22.333.444/0001-92",
      address: { city: "Santos" },
    });
  });

  it("deduplica importer e notify com o mesmo CNPJ", () => {
    const pending = pendingPartiesFromInvoice(
      makeInvoice({
        importer: makeParty({
          name: "Empresa Única",
          cnpj: CNPJ_EXISTENTE,
        }),
        notify: makeParty({
          name: "Empresa Única",
          cnpj: CNPJ_EXISTENTE,
        }),
      }),
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]?.roles).toEqual(["consignee", "notify"]);
  });

  it("ignora partes sem nome nem CNPJ", () => {
    const pending = pendingPartiesFromInvoice(
      makeInvoice({
        importer: makeParty({ name: "   ", cnpj: "abc" }),
        notify: makeParty({ name: null, cnpj: "" }),
      }),
    );

    expect(pending).toEqual([]);
  });

  it("mantém parte apenas com nome, mesmo sem CNPJ", () => {
    const pending = pendingPartiesFromInvoice(
      makeInvoice({
        importer: makeParty({ name: "Só Nome", cnpj: null }),
      }),
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      roles: ["consignee"],
      name: "Só Nome",
      cnpj: null,
    });
  });
});

describe("pendingPartiesFromBl", () => {
  it("usa consigneeDetails e notifyPartyDetails", () => {
    const pending = pendingPartiesFromBl(
      makeBl({
        consignee: "Texto ignorado",
        consigneeDetails: makeParty({
          name: "Consignatário Estruturado",
          cnpj: CNPJ_NOVO_CONSIGNEE,
          address: address({ street: "Rua D" }),
        }),
        notifyParty: "Texto ignorado",
        notifyPartyDetails: makeParty({
          name: "Notify Estruturado",
          cnpj: CNPJ_NOVO_NOTIFY,
          address: address({ city: "Santos" }),
        }),
      }),
    );

    expect(pending).toHaveLength(2);
    expect(pending.map((party) => party.name)).toEqual([
      "Consignatário Estruturado",
      "Notify Estruturado",
    ]);
    expect(pending.map((party) => party.roles)).toEqual([
      ["consignee"],
      ["notify"],
    ]);
  });

  it("usa consignee e notifyParty como fallback de nome", () => {
    const pending = pendingPartiesFromBl(
      makeBl({
        consignee: "Consignee Texto",
        consigneeDetails: makeParty({ name: null, cnpj: CNPJ_NOVO_CONSIGNEE }),
        notifyParty: "Notify Texto",
        notifyPartyDetails: makeParty({ name: null, cnpj: null }),
      }),
    );

    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({
      roles: ["consignee"],
      name: "Consignee Texto",
      cnpj: CNPJ_NOVO_CONSIGNEE,
    });
    expect(pending[1]).toMatchObject({
      roles: ["notify"],
      name: "Notify Texto",
      cnpj: null,
    });
  });

  it("ignora partes sem identidade nem fallback", () => {
    const pending = pendingPartiesFromBl(
      makeBl({
        consignee: null,
        consigneeDetails: makeParty(),
        notifyParty: "  ",
        notifyPartyDetails: makeParty(),
      }),
    );

    expect(pending).toEqual([]);
  });
});

function seedPartyPagination(): FakeSupabase {
  const names = [
    "Alfa Importadora",
    "Beta Comércio",
    "Delta Logística",
    "Empresa 100% Nacional",
    "Empresa 100X Nacional",
    "Gama Exportadora",
    "Gama_Exportadora",
    "Zeta Comércio",
  ];
  return new FakeSupabase({
    parties: [
      ...names.map((name, index) =>
        partySeed({
          id: `party-p-${index + 1}`,
          tenantId: "tenant-a",
          name,
          cnpjDigits: `${String(index + 1).repeat(8)}0001${String(index + 1).repeat(2)}`,
        }),
      ),
      partySeed({
        id: "party-p-b",
        tenantId: "tenant-b",
        name: "Alfa Importadora",
        cnpjDigits: CNPJ_OUTRO_TENANT,
      }),
    ],
  });
}

describe("listTenantParties", () => {
  it("lista somente as empresas do tenant, ordenadas por nome", async () => {
    const page = await listTenantParties("tenant-a");

    expect(page.rows.map((party) => party.name)).toEqual([
      "Alfa Importadora",
      "Zeta Comércio",
    ]);
    expect(page.rows[0]).toMatchObject({
      id: "party-a",
      cnpj: formatCnpj(CNPJ_EXISTENTE),
      address: {
        street: "Rua A",
        number: "100",
        city: "São Paulo",
        state: "SP",
        country: "Brasil",
      },
    });
    expect(page.rows).not.toContainEqual(
      expect.objectContaining({ id: "party-b" }),
    );
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(1);
  });

  it("pagina por padrão em 1 com 20 itens e total global", async () => {
    mocks.readClient = seedPartyPagination();

    const page = await listTenantParties("tenant-a");

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.rows).toHaveLength(8);
    expect(page.total).toBe(8);
    expect(page.totalPages).toBe(1);
  });

  it("devolve a página e o tamanho solicitados mantendo o total global", async () => {
    mocks.readClient = seedPartyPagination();

    const page = await listTenantParties("tenant-a", { page: 2, pageSize: 5 });

    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(5);
    expect(page.total).toBe(8);
    expect(page.totalPages).toBe(2);
    expect(page.rows.map((party) => party.name)).toEqual([
      "Gama Exportadora",
      "Gama_Exportadora",
      "Zeta Comércio",
    ]);
  });

  it("busca por nome sem diferenciar maiúsculas e minúsculas", async () => {
    mocks.readClient = seedPartyPagination();

    const page = await listTenantParties("tenant-a", { search: "  ALFA  " });

    expect(page.rows.map((party) => party.name)).toEqual(["Alfa Importadora"]);
    expect(page.total).toBe(1);
  });

  it("busca também pelo CNPJ", async () => {
    mocks.readClient = seedPartyPagination();

    const page = await listTenantParties("tenant-a", { search: "11.111" });

    expect(page.rows.map((party) => party.id)).toEqual(["party-p-1"]);
    expect(page.total).toBe(1);
  });

  it("escapa % e _ para que a busca trate os caracteres como literais", async () => {
    mocks.readClient = seedPartyPagination();

    const percent = await listTenantParties("tenant-a", { search: "100%" });
    expect(percent.rows.map((party) => party.name)).toEqual([
      "Empresa 100% Nacional",
    ]);
    expect(percent.total).toBe(1);

    const underscore = await listTenantParties("tenant-a", { search: "gama_" });
    expect(underscore.rows.map((party) => party.name)).toEqual([
      "Gama_Exportadora",
    ]);
    expect(underscore.total).toBe(1);
  });

  it("isola o total por tenant mesmo com busca", async () => {
    mocks.readClient = seedPartyPagination();

    const page = await listTenantParties("tenant-a", { search: "alfa" });

    expect(page.total).toBe(1);
    expect(page.rows.map((party) => party.id)).toEqual(["party-p-1"]);
  });

  it("lista empresas sem usar o admin client", async () => {
    mocks.failAdminClient = true;

    const page = await listTenantParties("tenant-a");

    expect(page.rows.map((party) => party.id)).toEqual([
      "party-a",
      "party-a-late",
    ]);
  });
});

describe("getPartyById", () => {
  it("busca a empresa do próprio tenant", async () => {
    await expect(getPartyById("tenant-a", "party-a")).resolves.toMatchObject({
      id: "party-a",
      name: "Alfa Importadora",
      cnpj: formatCnpj(CNPJ_EXISTENTE),
      address: { street: "Rua A", city: "São Paulo" },
    });
  });

  it("lança PartyNotFoundError para empresa de outro tenant", async () => {
    await expect(getPartyById("tenant-a", "party-b")).rejects.toBeInstanceOf(
      PartyNotFoundError,
    );
  });
});

describe("updateParty", () => {
  function validParams() {
    return {
      name: "  Zeta Atualizada  ",
      cnpj: "44.555.666/0001-74",
      address: address({
        street: "Rua Nova",
        number: "200",
        city: "Campinas",
        state: "SP",
        country: "Brasil",
      }),
    };
  }

  it("atualiza somente a empresa do tenant informado", async () => {
    const updated = await updateParty(
      "tenant-a",
      "party-a-late",
      validParams(),
    );

    expect(updated).toMatchObject({
      id: "party-a-late",
      name: "ZETA ATUALIZADA",
      cnpj: "44.555.666/0001-74",
      address: {
        street: "RUA NOVA",
        number: "200",
        city: "CAMPINAS",
      },
    });
    expect(findRow("parties", "party-a-late")).toMatchObject({
      tenant_id: "tenant-a",
      cnpj_digits: CNPJ_NOVO_CONSIGNEE,
      street: "RUA NOVA",
    });
    expect(findRow("parties", "party-b")).toMatchObject({
      name: "Beta Exterior",
      cnpj_digits: CNPJ_OUTRO_TENANT,
    });
  });

  it("grava a UF em minúsculas como sigla maiúscula", async () => {
    const updated = await updateParty("tenant-a", "party-a-late", {
      ...validParams(),
      address: address({
        street: "Rua Nova",
        city: "Joinville",
        state: "sc",
        country: "Brasil",
      }),
    });

    expect(updated.address.state).toBe("SC");
    expect(findRow("parties", "party-a-late")).toMatchObject({ state: "SC" });
  });

  it("grava o estado por extenso como sigla da UF", async () => {
    const updated = await updateParty("tenant-a", "party-a-late", {
      ...validParams(),
      address: address({
        street: "Rua Nova",
        city: "Florianópolis",
        state: "Santa Catarina",
        country: "Brasil",
      }),
    });

    expect(updated.address.state).toBe("SC");
    expect(findRow("parties", "party-a-late")).toMatchObject({ state: "SC" });
  });

  type PartyPayload = ReturnType<typeof validParams>;

  const invalidPayloads: Array<
    [string, (payload: PartyPayload) => PartyPayload, string]
  > = [
    [
      "nome vazio",
      (payload) => ({ ...payload, name: "   " }),
      "Nome é obrigatório",
    ],
    [
      "CNPJ com menos de 14 dígitos",
      (payload) => ({ ...payload, cnpj: "1234" }),
      "CNPJ deve ter 14 dígitos",
    ],
    [
      "rua vazia",
      (payload) => ({
        ...payload,
        address: address({ city: "Campinas", state: "SP", country: "Brasil" }),
      }),
      "Rua é obrigatória",
    ],
    [
      "cidade vazia",
      (payload) => ({
        ...payload,
        address: address({
          street: "Rua Nova",
          state: "SP",
          country: "Brasil",
        }),
      }),
      "Cidade é obrigatória",
    ],
    [
      "estado vazio",
      (payload) => ({
        ...payload,
        address: address({
          street: "Rua Nova",
          city: "Campinas",
          country: "Brasil",
        }),
      }),
      "Estado é obrigatório",
    ],
    [
      "UF inexistente",
      (payload) => ({
        ...payload,
        address: address({
          street: "Rua Nova",
          city: "Campinas",
          state: "XX",
          country: "Brasil",
        }),
      }),
      "Estado deve ser a sigla da UF (ex.: SC)",
    ],
    [
      "nome de estado incompleto",
      (payload) => ({
        ...payload,
        address: address({
          street: "Rua Nova",
          city: "Campinas",
          state: "Catarina",
          country: "Brasil",
        }),
      }),
      "Estado deve ser a sigla da UF (ex.: SC)",
    ],
    [
      "país vazio",
      (payload) => ({
        ...payload,
        address: address({
          street: "Rua Nova",
          city: "Campinas",
          state: "SP",
        }),
      }),
      "País é obrigatório",
    ],
  ];

  it.each(invalidPayloads)(
    "rejeita payload inválido: %s",
    async (_label, makePayload, message) => {
      await expect(
        updateParty("tenant-a", "party-a-late", makePayload(validParams())),
      ).rejects.toThrow(message);
    },
  );

  it("converte violação de unicidade (23505) em PartyValidationError", async () => {
    adminClient.failNext({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });

    await expect(
      updateParty("tenant-a", "party-a-late", validParams()),
    ).rejects.toThrow("Já existe empresa com este CNPJ");
  });

  it("não atualiza empresa de outro tenant e lança PartyNotFoundError", async () => {
    await expect(
      updateParty("tenant-a", "party-b", validParams()),
    ).rejects.toBeInstanceOf(PartyNotFoundError);

    expect(findRow("parties", "party-b")).toMatchObject({
      name: "Beta Exterior",
      cnpj_digits: CNPJ_OUTRO_TENANT,
    });
  });

  it("lança PartyNotFoundError quando a empresa não existe", async () => {
    await expect(
      updateParty("tenant-a", "party-inexistente", validParams()),
    ).rejects.toBeInstanceOf(PartyNotFoundError);
  });
});

describe("deleteParty", () => {
  it("remove somente a empresa do tenant informado", async () => {
    await expect(
      deleteParty("tenant-a", "party-a-late"),
    ).resolves.toBeUndefined();

    expect(admin.rows("parties").map((party) => party.id)).toEqual([
      "party-a",
      "party-b",
    ]);
  });

  it("não remove empresa de outro tenant e lança PartyNotFoundError", async () => {
    await expect(deleteParty("tenant-a", "party-b")).rejects.toBeInstanceOf(
      PartyNotFoundError,
    );

    expect(findRow("parties", "party-b")).toBeDefined();
  });

  it("lança PartyNotFoundError quando a empresa não existe", async () => {
    await expect(
      deleteParty("tenant-a", "party-inexistente"),
    ).rejects.toBeInstanceOf(PartyNotFoundError);
  });
});

describe("registerImportParties", () => {
  it("rejeita lista vazia de partes", async () => {
    await expect(
      registerImportParties({
        tenantId: "tenant-a",
        importId: "import-a",
        parties: [],
      }),
    ).rejects.toBeInstanceOf(PartyValidationError);
  });

  it("rejeita papel inválido", async () => {
    const invalid = pendingParty({
      roles: ["supplier" as unknown as PartyRole],
    });

    await expect(
      registerImportParties({
        tenantId: "tenant-a",
        importId: "import-a",
        parties: [invalid],
      }),
    ).rejects.toThrow("Papel da parte é inválido");
  });

  it("rejeita importação de outro tenant", async () => {
    await expect(
      registerImportParties({
        tenantId: "tenant-a",
        importId: "import-b",
        parties: [pendingParty()],
      }),
    ).rejects.toBeInstanceOf(ImportNotFoundError);
  });

  it("reaproveita empresa existente, cadastra a nova e vincula a importação", async () => {
    await registerImportParties({
      tenantId: "tenant-a",
      importId: "import-a",
      parties: [
        pendingParty({
          roles: ["consignee"],
          name: "  Alfa Importadora  ",
          cnpj: formatCnpj(CNPJ_EXISTENTE),
          address: address({
            street: "Rua A",
            city: "São Paulo",
            state: "SP",
            country: "Brasil",
          }),
        }),
        pendingParty({
          roles: ["notify"],
          name: "  Novo Notify  ",
          cnpj: "55.666.777/0001-85",
          address: address({
            street: "Rua E",
            number: "500",
            city: "Recife",
            state: "PE",
            country: "Brasil",
          }),
        }),
      ],
    });

    expect(findImport("import-a")).toMatchObject({
      consignee_id: "party-a",
      notify_id: expect.any(String),
    });
    expect(partiesWithCnpj(CNPJ_EXISTENTE)).toHaveLength(1);
    expect(partiesWithCnpj(CNPJ_NOVO)).toHaveLength(1);

    const created = partiesWithCnpj(CNPJ_NOVO)[0];
    expect(created).toMatchObject({
      tenant_id: "tenant-a",
      name: "NOVO NOTIFY",
      cnpj: "55.666.777/0001-85",
      cnpj_digits: CNPJ_NOVO,
      street: "RUA E",
      street_number: "500",
      city: "RECIFE",
      state: "PE",
      country: "BRASIL",
    });
    expect(findImport("import-a").notify_id).toBe(created?.id);
    expect(findImport("import-b")).toMatchObject({
      consignee_id: null,
      notify_id: null,
    });
  });

  it("vincula a mesma empresa como consignee e notify quando ela tem os dois papéis", async () => {
    await registerImportParties({
      tenantId: "tenant-a",
      importId: "import-a",
      parties: [
        pendingParty({
          roles: ["consignee", "notify"],
          name: "Empresa Dupla",
          cnpj: CNPJ_NOVO_CONSIGNEE,
          address: address({
            street: "Rua Dupla",
            city: "Campinas",
            state: "SP",
            country: "Brasil",
          }),
        }),
      ],
    });

    const [created] = partiesWithCnpj(CNPJ_NOVO_CONSIGNEE);
    expect(created?.id).toEqual(expect.any(String));
    expect(findImport("import-a")).toMatchObject({
      consignee_id: created?.id,
      notify_id: created?.id,
    });
  });

  it("normaliza a UF da parte vinda de documento antes de gravar", async () => {
    await registerImportParties({
      tenantId: "tenant-a",
      importId: "import-a",
      parties: [
        pendingParty({
          roles: ["consignee"],
          name: "Empresa de Santa Catarina",
          cnpj: CNPJ_NOVO,
          address: address({
            street: "Rua A",
            city: "Joinville",
            state: "Santa Catarina",
            country: "Brasil",
          }),
        }),
      ],
    });

    expect(partiesWithCnpj(CNPJ_NOVO)[0]).toMatchObject({ state: "SC" });
  });

  it("rejeita UF inválida da parte vinda de documento", async () => {
    await expect(
      registerImportParties({
        tenantId: "tenant-a",
        importId: "import-a",
        parties: [
          pendingParty({
            roles: ["consignee"],
            name: "Empresa Inválida",
            cnpj: CNPJ_NOVO,
            address: address({
              street: "Rua A",
              city: "Joinville",
              state: "Catarina",
              country: "Brasil",
            }),
          }),
        ],
      }),
    ).rejects.toThrow("Estado deve ser a sigla da UF (ex.: SC)");

    expect(partiesWithCnpj(CNPJ_NOVO)).toHaveLength(0);
  });

  it("descarta o papel consignee quando há consignee padrão", async () => {
    configureDefaultConsignee();

    await registerImportParties({
      tenantId: "tenant-a",
      importId: "import-a",
      parties: [
        pendingParty({
          roles: ["consignee"],
          name: "Novo Consignatário",
          cnpj: CNPJ_NOVO_CONSIGNEE,
        }),
      ],
    });

    expect(findImport("import-a")).toMatchObject({
      consignee_id: null,
      notify_id: null,
    });
    expect(partiesWithCnpj(CNPJ_NOVO_CONSIGNEE)).toHaveLength(0);
  });

  it("cadastra apenas o notify quando a parte tem os dois papéis", async () => {
    configureDefaultConsignee();

    await registerImportParties({
      tenantId: "tenant-a",
      importId: "import-a",
      parties: [
        pendingParty({
          roles: ["consignee", "notify"],
          name: "Empresa Dupla",
          cnpj: CNPJ_NOVO,
          address: address({
            street: "Rua Dupla",
            city: "Campinas",
            state: "SP",
            country: "Brasil",
          }),
        }),
      ],
    });

    const [created] = partiesWithCnpj(CNPJ_NOVO);
    expect(created?.id).toEqual(expect.any(String));
    expect(findImport("import-a")).toMatchObject({
      consignee_id: null,
      notify_id: created?.id,
    });
  });
});

describe("getImportPartiesState", () => {
  it("retorna estado vazio quando não há extrações", async () => {
    await expect(
      getImportPartiesState("tenant-a", "import-empty"),
    ).resolves.toEqual({
      importId: "import-empty",
      pendingParties: [],
      linked: false,
      invoice: null,
      defaultConsignee: null,
      documentConsignee: null,
      consigneeDivergences: [],
    });
  });

  it("devolve pendentes da invoice e marca linked quando o consignee existe", async () => {
    const state = await getImportPartiesState("tenant-a", "import-invoice");

    expect(state.importId).toBe("import-invoice");
    expect(state.invoice).toEqual(invoiceComExistente);
    expect(state.linked).toBe(true);
    expect(state.pendingParties).toHaveLength(1);
    expect(state.pendingParties[0]).toMatchObject({
      roles: ["notify"],
      name: "Novo Notify",
      cnpj: CNPJ_NOVO_NOTIFY,
      address: { street: "Rua C", city: "Curitiba", state: "PR" },
    });
    expect(findImport("import-invoice").consignee_id).toBe("party-a");
    expect(findImport("import-invoice").notify_id).toBeNull();
  });

  it("devolve pendentes do BL e marca linked quando o notify existe", async () => {
    const state = await getImportPartiesState("tenant-a", "import-bl");

    expect(state.invoice).toBeNull();
    expect(state.linked).toBe(true);
    expect(state.pendingParties).toHaveLength(1);
    expect(state.pendingParties[0]).toMatchObject({
      roles: ["consignee"],
      name: "Novo Consignatário",
      cnpj: CNPJ_NOVO_CONSIGNEE,
      address: { street: "Rua D" },
    });
    expect(findImport("import-bl").notify_id).toBe("party-a");
    expect(findImport("import-bl").consignee_id).toBeNull();
  });

  it("lança ImportNotFoundError para importação de outro tenant", async () => {
    await expect(
      getImportPartiesState("tenant-a", "import-b"),
    ).rejects.toBeInstanceOf(ImportNotFoundError);
  });
});

describe("getImportPartiesState com consignee padrão", () => {
  beforeEach(() => {
    configureDefaultConsignee();
  });

  it("ignora o consignee pendente e expõe padrão, documento e divergências", async () => {
    const state = await getImportPartiesState("tenant-a", "import-invoice");

    expect(state.defaultConsignee).toMatchObject({
      id: "party-default",
      name: "Consignatário Padrão",
    });
    expect(state.documentConsignee).toMatchObject({
      name: "Alfa Importadora",
      cnpj: CNPJ_EXISTENTE,
    });
    expect(state.consigneeDivergences.map((item) => item.field)).toEqual([
      "name",
      "cnpj",
      "street",
      "city",
    ]);
    expect(state.pendingParties.map((party) => party.roles)).toEqual([
      ["notify"],
    ]);
    expect(findImport("import-invoice").consignee_id).toBeNull();
    expect(state.linked).toBe(false);
  });

  it("mantém o notify do BL e não cria pendente de consignee", async () => {
    const state = await getImportPartiesState("tenant-a", "import-bl");

    expect(state.pendingParties).toEqual([]);
    expect(findImport("import-bl").notify_id).toBe("party-a");
    expect(findImport("import-bl").consignee_id).toBeNull();
    expect(state.linked).toBe(true);
    expect(state.documentConsignee).toMatchObject({
      name: "Novo Consignatário",
      cnpj: CNPJ_NOVO_CONSIGNEE,
    });
    expect(state.consigneeDivergences.map((item) => item.field)).toEqual([
      "name",
      "cnpj",
      "street",
    ]);
  });
});

describe("resolveInvoiceParties", () => {
  it("reaproveita empresa do tenant e vincula o consignee", async () => {
    const pending = await resolveInvoiceParties({
      tenantId: "tenant-a",
      importId: "import-a",
      invoice: makeInvoice({
        importer: makeParty({
          name: "Alfa Importadora",
          cnpj: CNPJ_EXISTENTE,
        }),
      }),
    });

    expect(pending).toEqual([]);
    expect(findImport("import-a").consignee_id).toBe("party-a");
    expect(findImport("import-a").notify_id).toBeNull();
  });

  it("devolve pendente para CNPJ que só existe em outro tenant e não cria empresa", async () => {
    const before = admin.rows("parties").length;

    const pending = await resolveInvoiceParties({
      tenantId: "tenant-a",
      importId: "import-a",
      invoice: makeInvoice({
        importer: makeParty({
          name: "Alfa Importadora",
          cnpj: CNPJ_EXISTENTE,
        }),
        notify: makeParty({
          name: "Beta Exterior",
          cnpj: CNPJ_OUTRO_TENANT,
        }),
      }),
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      roles: ["notify"],
      name: "Beta Exterior",
      cnpj: CNPJ_OUTRO_TENANT,
    });
    expect(findImport("import-a").consignee_id).toBe("party-a");
    expect(findImport("import-a").notify_id).toBeNull();
    expect(admin.rows("parties")).toHaveLength(before);
    expect(findImport("import-b").notify_id).toBeNull();
  });

  it("ignora o consignee do documento quando skipConsignee", async () => {
    const pending = await resolveInvoiceParties({
      tenantId: "tenant-a",
      importId: "import-a",
      invoice: makeInvoice({
        importer: makeParty({
          name: "Alfa Importadora",
          cnpj: CNPJ_EXISTENTE,
        }),
        notify: makeParty({
          name: "Novo Notify",
          cnpj: CNPJ_NOVO_NOTIFY,
        }),
      }),
      skipConsignee: true,
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      roles: ["notify"],
      name: "Novo Notify",
      cnpj: CNPJ_NOVO_NOTIFY,
    });
    expect(findImport("import-a").consignee_id).toBeNull();
    expect(findImport("import-a").notify_id).toBeNull();
  });
});

describe("resolveBlParties", () => {
  it("reaproveita empresa do tenant e vincula o notify", async () => {
    const pending = await resolveBlParties({
      tenantId: "tenant-a",
      importId: "import-a",
      bl: makeBl({
        consigneeDetails: makeParty({
          name: "Novo Consignatário",
          cnpj: CNPJ_NOVO_CONSIGNEE,
        }),
        notifyPartyDetails: makeParty({
          name: "Alfa Importadora",
          cnpj: CNPJ_EXISTENTE,
        }),
      }),
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      roles: ["consignee"],
      name: "Novo Consignatário",
      cnpj: CNPJ_NOVO_CONSIGNEE,
    });
    expect(findImport("import-a").notify_id).toBe("party-a");
    expect(findImport("import-a").consignee_id).toBeNull();
  });

  it("usa o texto do BL como fallback e devolve parte pendente sem CNPJ", async () => {
    const pending = await resolveBlParties({
      tenantId: "tenant-a",
      importId: "import-a",
      bl: makeBl({
        consignee: "Consignee Texto",
        consigneeDetails: makeParty({ name: null, cnpj: null }),
        notifyParty: "Notify Texto",
        notifyPartyDetails: makeParty({ name: null, cnpj: null }),
      }),
    });

    expect(pending).toHaveLength(2);
    expect(
      pending.map((party) => [party.roles, party.name, party.cnpj]),
    ).toEqual([
      [["consignee"], "Consignee Texto", null],
      [["notify"], "Notify Texto", null],
    ]);
    expect(findImport("import-a").consignee_id).toBeNull();
    expect(findImport("import-a").notify_id).toBeNull();
  });

  it("ignora o consignee do BL quando skipConsignee", async () => {
    const pending = await resolveBlParties({
      tenantId: "tenant-a",
      importId: "import-a",
      bl: makeBl({
        consigneeDetails: makeParty({
          name: "Novo Consignatário",
          cnpj: CNPJ_NOVO_CONSIGNEE,
        }),
        notifyPartyDetails: makeParty({
          name: "Alfa Importadora",
          cnpj: CNPJ_EXISTENTE,
        }),
      }),
      skipConsignee: true,
    });

    expect(pending).toEqual([]);
    expect(findImport("import-a").notify_id).toBe("party-a");
    expect(findImport("import-a").consignee_id).toBeNull();
  });
});
