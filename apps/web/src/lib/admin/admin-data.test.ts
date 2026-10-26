import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdminTenantDetail,
  listAdminTenants,
  recordAdminTenantView,
} from "@/lib/admin/admin-data";
import { FakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

let admin: FakeSupabase;

beforeEach(() => {
  admin = new FakeSupabase({
    tenants: [],
    imports: [],
    documents: [],
    parties: [],
    ncms: [],
    ai_logs: [],
    audit_logs: [],
  });
  mocks.admin = admin;
});

function seed() {
  admin.rows("tenants").push(
    {
      id: "tenant-a",
      name: "Empresa A",
      created_at: "2026-01-10T10:00:00.000Z",
    },
    {
      id: "tenant-b",
      name: "Empresa B",
      created_at: "2026-02-20T10:00:00.000Z",
    },
  );

  admin.rows("imports").push(
    {
      id: "import-a1",
      tenant_id: "tenant-a",
      reference_number: "REF-A1",
      status: "completed",
      supplier_name: "Fornecedor A",
      invoice_number: "INV-A1",
      bl_number: "BL-A1",
      created_at: "2026-03-01T10:00:00.000Z",
    },
    {
      id: "import-a2",
      tenant_id: "tenant-a",
      reference_number: "REF-A2",
      status: "processing",
      supplier_name: null,
      invoice_number: null,
      bl_number: null,
      created_at: "2026-03-02T10:00:00.000Z",
    },
    {
      id: "import-b1",
      tenant_id: "tenant-b",
      reference_number: "REF-B1",
      status: "uploaded",
      supplier_name: null,
      invoice_number: null,
      bl_number: null,
      created_at: "2026-03-03T10:00:00.000Z",
    },
  );

  admin.rows("documents").push(
    { id: "doc-a1", tenant_id: "tenant-a", created_at: "2026-03-01T10:00:00.000Z" },
    { id: "doc-b1", tenant_id: "tenant-b", created_at: "2026-03-01T10:00:00.000Z" },
  );

  admin.rows("parties").push(
    {
      id: "party-a1",
      tenant_id: "tenant-a",
      name: "Empresa A",
      cnpj: "11.111.111/0001-11",
      city: "São Paulo",
      state: "SP",
      created_at: "2026-01-11T10:00:00.000Z",
      updated_at: "2026-01-12T10:00:00.000Z",
    },
    {
      id: "party-b1",
      tenant_id: "tenant-b",
      name: "Empresa B",
      cnpj: "22.222.222/0001-22",
      city: "Curitiba",
      state: "PR",
      created_at: "2026-02-21T10:00:00.000Z",
      updated_at: "2026-02-22T10:00:00.000Z",
    },
  );

  admin.rows("ncms").push(
    {
      id: "ncm-a1",
      tenant_id: "tenant-a",
      code: "84713012",
      description: "Notebooks",
      updated_at: "2026-01-13T10:00:00.000Z",
    },
    {
      id: "ncm-b1",
      tenant_id: "tenant-b",
      code: "01012100",
      description: "Cavalos reprodutores",
      updated_at: "2026-02-23T10:00:00.000Z",
    },
  );

  admin.rows("ai_logs").push(
    {
      id: "log-a1",
      tenant_id: "tenant-a",
      capability: "extract_invoice",
      model: "modelo-a",
      status: "success",
      tokens_in: 100,
      tokens_out: 40,
      cost_usd: 0.0025,
      latency_ms: 900,
      import_id: "import-a1",
      created_at: "2026-03-01T11:00:00.000Z",
    },
    {
      id: "log-a2",
      tenant_id: "tenant-a",
      capability: "classify",
      model: "modelo-a",
      status: "success",
      tokens_in: 10,
      tokens_out: 5,
      cost_usd: null,
      latency_ms: 300,
      import_id: null,
      created_at: "2026-03-02T11:00:00.000Z",
    },
    {
      id: "log-b1",
      tenant_id: "tenant-b",
      capability: "classify",
      model: "modelo-b",
      status: "success",
      tokens_in: 999,
      tokens_out: 1,
      cost_usd: 1,
      latency_ms: 100,
      import_id: null,
      created_at: "2026-03-03T11:00:00.000Z",
    },
  );
}

describe("listAdminTenants", () => {
  it("retorna cada tenant com contadores e uso de IA isolados", async () => {
    seed();

    const tenants = await listAdminTenants();

    expect(tenants).toHaveLength(2);
    const [first, second] = tenants;
    // Ordenação: created_at desc.
    expect(first).toEqual({
      id: "tenant-b",
      name: "Empresa B",
      created_at: "2026-02-20T10:00:00.000Z",
      imports: 1,
      documents: 1,
      parties: 1,
      ncms: 1,
      aiTokens: 1000,
      aiCostUsd: 1,
    });
    expect(second).toEqual({
      id: "tenant-a",
      name: "Empresa A",
      created_at: "2026-01-10T10:00:00.000Z",
      imports: 2,
      documents: 1,
      parties: 1,
      ncms: 1,
      aiTokens: 155,
      aiCostUsd: 0.0025,
    });
  });

  it("retorna lista vazia quando não há tenants", async () => {
    await expect(listAdminTenants()).resolves.toEqual([]);
  });

  it("propaga erro do select de tenants", async () => {
    admin.failNext("select failed");

    await expect(listAdminTenants()).rejects.toThrow("select failed");
  });
});

describe("getAdminTenantDetail", () => {
  it("filtra todas as consultas pelo tenant pedido", async () => {
    seed();

    const detail = await getAdminTenantDetail("tenant-a");

    expect(detail).not.toBeNull();
    expect(detail?.tenant).toEqual({
      id: "tenant-a",
      name: "Empresa A",
      created_at: "2026-01-10T10:00:00.000Z",
    });
    expect(detail?.counts).toEqual({
      imports: 2,
      documents: 1,
      parties: 1,
      ncms: 1,
      aiLogs: 2,
    });
    expect(detail?.imports.map((row) => row.id)).toEqual([
      "import-a2",
      "import-a1",
    ]);
    expect(detail?.parties.map((row) => row.id)).toEqual(["party-a1"]);
    expect(detail?.ncms.map((row) => row.id)).toEqual(["ncm-a1"]);
    expect(detail?.aiLogs.map((row) => row.id)).toEqual(["log-a2", "log-a1"]);
    expect(detail?.aiLogs[1]).toMatchObject({
      cost_usd: 0.0025,
      tokens_in: 100,
      tokens_out: 40,
      import_id: "import-a1",
    });
  });

  it("retorna null para tenant inexistente", async () => {
    seed();

    await expect(getAdminTenantDetail("tenant-inexistente")).resolves.toBeNull();
  });

  it("propaga erro do select do tenant", async () => {
    admin.failNext("select failed");

    await expect(getAdminTenantDetail("tenant-a")).rejects.toThrow(
      "select failed",
    );
  });

  it("propaga erro de uma das listas", async () => {
    seed();
    admin.failNext("ncms failed", { table: "ncms", operation: "select" });

    await expect(getAdminTenantDetail("tenant-a")).rejects.toThrow("ncms failed");
  });
});

describe("recordAdminTenantView", () => {
  it("grava a auditoria no tenant do admin", async () => {
    await recordAdminTenantView({
      actorTenantId: "tenant-admin",
      actorUserId: "user-1",
      viewedTenantId: "tenant-a",
      path: "/admin/tenant-a",
    });

    expect(admin.rows("audit_logs")).toEqual([
      expect.objectContaining({
        tenant_id: "tenant-admin",
        user_id: "user-1",
        action: "admin.view_tenant",
        entity: "tenant",
        entity_id: "tenant-a",
        after_state: {
          path: "/admin/tenant-a",
          viewed_tenant_id: "tenant-a",
        },
      }),
    ]);
  });

  it("propaga erro do insert", async () => {
    admin.failNext("insert failed", {
      table: "audit_logs",
      operation: "insert",
    });

    await expect(
      recordAdminTenantView({
        actorTenantId: "tenant-admin",
        actorUserId: "user-1",
        viewedTenantId: "tenant-a",
        path: "/admin/tenant-a",
      }),
    ).rejects.toThrow("insert failed");
  });
});
