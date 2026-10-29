import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listTenantTracking,
  matchesTrackingFilter,
  summarizeTracking,
  type TenantTrackingRow,
} from "@/lib/tracking/list";
import { FakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.db,
}));

/** Data local fixa para os cálculos de "chegando"/"em X dias". */
const NOW = new Date(2026, 9, 28, 12, 0, 0);

type ShipmentOverrides = Record<string, unknown>;

function shipment(overrides: ShipmentOverrides): Record<string, unknown> {
  return {
    tenant_id: "tenant-1",
    carrier_code: "maersk",
    query_type: "bl",
    query_value: "BL-001",
    status: "in_transit",
    eta: null,
    last_event_at: null,
    last_event_description: null,
    next_check_at: null,
    fetched_at: null,
    ...overrides,
  };
}

function createDb(): FakeSupabase {
  return new FakeSupabase({
    imports: [
      {
        id: "imp-1",
        tenant_id: "tenant-1",
        reference_number: "IMP-001",
        invoice_number: "INV-001",
        bl_number: "BL-001",
      },
      {
        id: "imp-2",
        tenant_id: "tenant-1",
        reference_number: null,
        invoice_number: "INV-002",
        bl_number: "BL-002",
      },
      {
        id: "imp-3",
        tenant_id: "tenant-2",
        reference_number: "OUTRO",
        invoice_number: "INV-003",
        bl_number: "BL-003",
      },
      {
        id: "imp-4",
        tenant_id: "tenant-1",
        reference_number: "IMP-004",
        invoice_number: null,
        bl_number: null,
      },
    ],
    tracking_shipments: [
      shipment({
        id: "s1",
        import_id: "imp-1",
        query_value: "BL-001",
        eta: "2026-11-20",
        last_event_at: "2026-10-27T10:00:00.000Z",
        last_event_description: "Saiu do porto de origem",
        next_check_at: "2026-10-29T10:00:00.000Z",
        fetched_at: "2026-10-27T10:00:00.000Z",
      }),
      shipment({
        id: "s2",
        import_id: "imp-2",
        query_value: "BL-002",
        eta: "2026-12-05",
        last_event_at: "2026-10-20T10:00:00.000Z",
        last_event_description: "Em transbordo",
        next_check_at: "2026-11-03T10:00:00.000Z",
        fetched_at: "2026-10-20T10:00:00.000Z",
      }),
      shipment({
        id: "s3",
        tenant_id: "tenant-2",
        import_id: "imp-3",
        query_value: "BL-003",
      }),
    ],
  });
}

beforeEach(() => {
  mocks.db = createDb();
});

describe("listTenantTracking", () => {
  it("lista apenas o tenant e resolve a importação em uma consulta em lote", async () => {
    const db = mocks.db as FakeSupabase;

    const result = await listTenantTracking({
      tenantId: "tenant-1",
      now: NOW,
    });

    expect(result.rows.map((row) => row.shipmentId)).toEqual(["s1", "s2"]);
    expect(result.rows[0]).toMatchObject({
      importId: "imp-1",
      importReference: "IMP-001",
      blNumber: "BL-001",
      carrier: "Maersk",
      queryType: "bl",
      queryValue: "BL-001",
      status: "in_transit",
      statusLabel: "Em trânsito",
      statusVariant: "default",
      lastEventDescription: "Saiu do porto de origem",
    });
    // Sem referência própria: cai para o BL.
    expect(result.rows[1]?.importReference).toBe("BL-002");

    const importsQueries = db.queries.filter(
      (query) => query.table === "imports",
    );
    expect(importsQueries).toHaveLength(1);
    expect(db.queries.filter((query) => query.table === "tracking_shipments"))
      .toHaveLength(1);
    expect(
      db.queries
        .find((query) => query.table === "tracking_shipments")
        ?.filters.find((filter) => filter.column === "tenant_id")?.value,
    ).toBe("tenant-1");
  });

  it("filtra por importação e devolve a referência do escopo", async () => {
    const db = mocks.db as FakeSupabase;

    const result = await listTenantTracking({
      tenantId: "tenant-1",
      importId: "imp-1",
      now: NOW,
    });

    expect(result.rows.map((row) => row.shipmentId)).toEqual(["s1"]);
    expect(result.scope).toEqual({ importId: "imp-1", reference: "IMP-001" });
    expect(
      db.queries
        .find((query) => query.table === "tracking_shipments")
        ?.filters.find((filter) => filter.column === "import_id")?.value,
    ).toBe("imp-1");
  });

  it("mantém o escopo mesmo quando a importação não tem shipments", async () => {
    const result = await listTenantTracking({
      tenantId: "tenant-1",
      importId: "imp-4",
      now: NOW,
    });

    expect(result.rows).toHaveLength(0);
    expect(result.scope).toEqual({ importId: "imp-4", reference: "IMP-004" });

    const unknown = await listTenantTracking({
      tenantId: "tenant-1",
      importId: "imp-inexistente",
      now: NOW,
    });
    expect(unknown.rows).toHaveLength(0);
    expect(unknown.scope).toEqual({
      importId: "imp-inexistente",
      reference: null,
    });
  });

  it("ordena pelo último evento mais recente e deixa quem não tem evento no fim", async () => {
    const db = mocks.db as FakeSupabase;
    db.rows("tracking_shipments").push(
      shipment({
        id: "s4",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        query_value: "BL-004",
        last_event_at: "2026-10-25T10:00:00.000Z",
      }),
      shipment({
        id: "s5",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        query_value: "BL-005",
        last_event_at: null,
      }),
    );

    const result = await listTenantTracking({
      tenantId: "tenant-1",
      now: NOW,
    });

    expect(result.rows.map((row) => row.shipmentId)).toEqual([
      "s1",
      "s4",
      "s2",
      "s5",
    ]);
  });

  it("filtra 'chegando' por ETA nos próximos 7 dias e ignora status finais", async () => {
    const db = mocks.db as FakeSupabase;
    db.rows("tracking_shipments").push(
      shipment({
        id: "s-5d",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: "2026-11-02",
      }),
      shipment({
        id: "s-10d",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: "2026-11-07",
      }),
      shipment({
        id: "s-entregue",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: "2026-10-31",
        status: "delivered",
      }),
    );

    const result = await listTenantTracking({
      tenantId: "tenant-1",
      filter: "chegando",
      now: NOW,
    });

    expect(result.rows.map((row) => row.shipmentId)).toEqual(["s-5d"]);
    expect(result.summary.arriving).toBe(1);
  });

  it("filtra 'sem_eta' e 'sem_consulta'", async () => {
    const db = mocks.db as FakeSupabase;
    db.rows("tracking_shipments").push(
      shipment({
        id: "s-sem-eta",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: null,
      }),
      shipment({
        id: "s-eta-vazio",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: "  ",
      }),
      shipment({
        id: "s-nunca-consultado",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: "2026-11-20",
        fetched_at: null,
        next_check_at: "2026-10-29T10:00:00.000Z",
      }),
      shipment({
        id: "s-entregue-sem-proxima",
        tenant_id: "tenant-1",
        import_id: "imp-1",
        eta: "2026-10-01",
        status: "delivered",
        fetched_at: "2026-10-02T10:00:00.000Z",
        next_check_at: null,
      }),
    );

    const withoutEta = await listTenantTracking({
      tenantId: "tenant-1",
      filter: "sem_eta",
      now: NOW,
    });
    expect(withoutEta.rows.map((row) => row.shipmentId).sort()).toEqual([
      "s-eta-vazio",
      "s-sem-eta",
    ]);
    // s3 (tenant-2) também não tem ETA, mas não pertence ao tenant.
    expect(withoutEta.summary.withoutEta).toBe(2);

    const withoutCheck = await listTenantTracking({
      tenantId: "tenant-1",
      filter: "sem_consulta",
      now: NOW,
    });
    const ids = withoutCheck.rows.map((row) => row.shipmentId);
    expect(ids).toContain("s-nunca-consultado");
    expect(ids).toContain("s-sem-eta");
    expect(ids).not.toContain("s1");
    expect(ids).not.toContain("s-entregue-sem-proxima");
  });

  it("respeita o limite depois do filtro", async () => {
    const result = await listTenantTracking({
      tenantId: "tenant-1",
      limit: 1,
      now: NOW,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.shipmentId).toBe("s1");
    expect(result.summary.total).toBe(2);
  });
});

describe("matchesTrackingFilter", () => {
  const base: Pick<
    TenantTrackingRow,
    "status" | "eta" | "nextCheckAt" | "fetchedAt"
  > = {
    status: "in_transit",
    eta: "2026-11-02",
    nextCheckAt: "2026-10-29T10:00:00.000Z",
    fetchedAt: "2026-10-27T10:00:00.000Z",
  };

  it("considera trânsito e transbordo em 'transito'", () => {
    expect(matchesTrackingFilter(base, "transito", NOW)).toBe(true);
    expect(
      matchesTrackingFilter(
        { ...base, status: "transshipment" },
        "transito",
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesTrackingFilter({ ...base, status: "delivered" }, "transito", NOW),
    ).toBe(false);
  });

  it("'chegando' inclui ETA atrasado e exclui terminal", () => {
    expect(
      matchesTrackingFilter({ ...base, eta: "2026-10-20" }, "chegando", NOW),
    ).toBe(true);
    expect(
      matchesTrackingFilter({ ...base, status: "delivered" }, "chegando", NOW),
    ).toBe(false);
    expect(matchesTrackingFilter({ ...base, eta: null }, "chegando", NOW)).toBe(
      false,
    );
  });

  it("'sem_consulta' aceita fetched_at nulo e shipment não terminal sem próxima consulta", () => {
    expect(
      matchesTrackingFilter({ ...base, fetchedAt: null }, "sem_consulta", NOW),
    ).toBe(true);
    expect(
      matchesTrackingFilter(
        { ...base, nextCheckAt: null },
        "sem_consulta",
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesTrackingFilter(
        { ...base, nextCheckAt: null, status: "delivered" },
        "sem_consulta",
        NOW,
      ),
    ).toBe(false);
  });

  it("'todos' não filtra", () => {
    expect(matchesTrackingFilter(base, "todos", NOW)).toBe(true);
  });
});

describe("summarizeTracking", () => {
  it("conta trânsito, chegando, sem ETA e sem consulta", () => {
    const summary = summarizeTracking(
      [
        {
          status: "in_transit" as const,
          eta: "2026-11-02",
          nextCheckAt: "2026-10-29T10:00:00.000Z",
          fetchedAt: "2026-10-27T10:00:00.000Z",
        },
        {
          status: "transshipment" as const,
          eta: "2026-12-01",
          nextCheckAt: "2026-11-20T10:00:00.000Z",
          fetchedAt: "2026-10-27T10:00:00.000Z",
        },
        {
          status: "pending" as const,
          eta: null,
          nextCheckAt: null,
          fetchedAt: null,
        },
      ],
      NOW,
    );

    expect(summary).toEqual({
      total: 3,
      inTransit: 2,
      arriving: 1,
      withoutEta: 1,
      withoutCheck: 1,
    });
  });
});
