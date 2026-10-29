import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrackingShipmentDetail,
  TrackingShipmentNotFoundError,
} from "@/lib/tracking/detail";
import { FakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.db,
}));

const TENANT = "tenant-1";

function shipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship-1",
    tenant_id: TENANT,
    import_id: "imp-1",
    carrier_code: "maersk",
    query_type: "bl",
    query_value: "276430227",
    container_number: null,
    status: "in_transit",
    vessel: "SAN NICOLAS MAERSK",
    voyage: "639W",
    eta: "2026-11-12",
    eta_original: "2026-11-10",
    ata: null,
    fetched_at: "2026-10-27T10:00:00.000Z",
    next_check_at: "2026-11-02T10:00:00.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    tenant_id: TENANT,
    shipment_id: "ship-1",
    event_at: "2026-10-20T09:00:00.000Z",
    status: "in_transit",
    location: "Shekou",
    description: "Loaded on board",
    vessel: "SAN NICOLAS MAERSK",
    voyage: "639W",
    container_number: null,
    source: "scrape",
    created_at: "2026-10-20T09:00:00.000Z",
    ...overrides,
  };
}

function blPayload(overrides: Record<string, unknown> = {}) {
  return {
    number: "276430227",
    carrier: "Maersk",
    polCity: "Shekou",
    polCountry: "China",
    podCity: "Itapoá",
    podCountry: "Brasil",
    onboardDate: "22/10/2026",
    vessel: "SAN NICOLAS MAERSK",
    voyage: "639W",
    containerNumbers: ["MMAU1421499"],
    eta: "12/11/2026",
    ...overrides,
  };
}

function createDb(): FakeSupabase {
  return new FakeSupabase({
    imports: [
      {
        id: "imp-1",
        tenant_id: TENANT,
        reference_number: "IMP-001",
        invoice_number: "INV-001",
        bl_number: "276430227",
      },
    ],
    tracking_shipments: [
      shipmentRow(),
      shipmentRow({
        id: "ship-container",
        query_type: "container",
        query_value: "MMAU1421499",
        container_number: "MMAU1421499",
        eta: "2026-11-12",
        created_at: "2026-10-20T11:00:00.000Z",
      }),
    ],
    tracking_events: [
      eventRow({
        id: "ev-3",
        event_at: "2026-11-10T09:00:00.000Z",
        status: "discharged",
        location: "Santos",
        description: "Discharged at Santos",
      }),
      eventRow({
        id: "ev-2",
        event_at: "2026-10-25T09:00:00.000Z",
        status: "transshipment",
        location: "Singapore",
        description: "Transshipment at Singapore",
      }),
      eventRow({ id: "ev-1" }),
    ],
    documents: [
      {
        id: "doc-bl",
        tenant_id: TENANT,
        import_id: "imp-1",
        doc_type: "bill_of_lading",
        created_at: "2026-10-20T10:00:00.000Z",
      },
    ],
    extraction_results: [
      {
        id: "ext-bl",
        tenant_id: TENANT,
        document_id: "doc-bl",
        payload: blPayload(),
        created_at: "2026-10-20T10:05:00.000Z",
      },
    ],
  });
}

function db(): FakeSupabase {
  return mocks.db as FakeSupabase;
}

beforeEach(() => {
  mocks.db = createDb();
});

describe("getTrackingShipmentDetail — atraso", () => {
  it("marca atraso sobre o ETA quando ainda não há ATA", async () => {
    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.ata).toBeNull();
    expect(detail.derived).toMatchObject({
      delayDays: 2,
      delayLabel: "Atrasado +2 dias",
      delayVariant: "destructive",
    });
  });

  it("usa o ATA como chegada real quando ele existe", async () => {
    db().rows("tracking_shipments")[0]!.ata = "2026-11-15";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.ata).toBe("2026-11-15");
    expect(detail.derived.delayDays).toBe(5);
    expect(detail.derived.delayLabel).toBe("Atrasado +5 dias");
  });

  it("marca adiantado quando a chegada é antes do ETA original", async () => {
    db().rows("tracking_shipments")[0]!.eta = "2026-11-08";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.derived).toMatchObject({
      delayDays: -2,
      delayLabel: "Adiantado −2 dias",
      delayVariant: "success",
    });
  });

  it("marca 'No prazo' quando as datas batem", async () => {
    db().rows("tracking_shipments")[0]!.eta = "2026-11-10";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.derived).toMatchObject({
      delayDays: 0,
      delayLabel: "No prazo",
      delayVariant: "secondary",
    });
  });

  it("não calcula atraso sem o ETA original do armador", async () => {
    db().rows("tracking_shipments")[0]!.eta_original = null;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.derived.delayDays).toBeNull();
    expect(detail.derived.delayLabel).toBeNull();
    expect(detail.derived.delayVariant).toBe("outline");
  });
});

describe("getTrackingShipmentDetail — rota e trânsito", () => {
  it("calcula o tempo de trânsito do primeiro evento até o ETA", async () => {
    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    // 20/10/2026 (primeiro evento) → 12/11/2026 (ETA).
    expect(detail.derived.transitDays).toBe(23);
  });

  it("cai para a data de embarque do BL quando não há eventos", async () => {
    db().rows("tracking_events").length = 0;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    // 22/10/2026 (onboard) → 12/11/2026 (ETA).
    expect(detail.derived.transitDays).toBe(21);
    expect(detail.events).toEqual([]);
  });

  it("monta POL/POD com cidade e país e conta transbordos", async () => {
    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.route).toEqual({
      origin: { label: "Shekou, China", date: "22/10/2026" },
      destination: { label: "Itapoá, Brasil", date: "2026-11-12" },
      onboardDate: "22/10/2026",
      direct: false,
    });
    expect(detail.derived.transhipments).toBe(1);
    expect(detail.derived.containers).toEqual(["MMAU1421499"]);
    expect(detail.billOfLading?.containers).toEqual(["MMAU1421499"]);
    expect(detail.billOfLading?.originCity).toBe("Shekou");
  });

  it("usa o primeiro evento como saída quando o BL não traz onboard date", async () => {
    const extraction = db().rows("extraction_results")[0]!;
    extraction.payload = blPayload({ onboardDate: null });

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.route.origin?.date).toBe("2026-10-20T09:00:00.000Z");
  });

  it("devolve rota vazia quando a importação não tem BL extraído", async () => {
    db().rows("documents").length = 0;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.billOfLading).toBeNull();
    expect(detail.route).toEqual({
      origin: null,
      destination: null,
      onboardDate: null,
      direct: false,
    });
  });
});

describe("getTrackingShipmentDetail — próxima consulta", () => {
  it("mostra a data agendada quando existe", async () => {
    // Data pura: o rótulo não depende do fuso do runner.
    db().rows("tracking_shipments")[0]!.next_check_at = "2026-11-02";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.nextCheckAt).toBe("2026-11-02");
    expect(detail.shipment.nextCheckLabel).toBe("02/11/2026");
  });

  it("usa 'Concluído' apenas em status final", async () => {
    db().rows("tracking_shipments")[0]!.status = "delivered";
    db().rows("tracking_shipments")[0]!.next_check_at = null;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.nextCheckLabel).toBe("Concluído");
  });

  it("não mostra 'Concluído' para shipment ativo sem próxima consulta", async () => {
    db().rows("tracking_shipments")[0]!.next_check_at = null;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.nextCheckLabel).toBe("Aguardando consulta");
    expect(detail.shipment.nextCheckLabel).not.toBe("Concluído");
  });
});

describe("getTrackingShipmentDetail — navio e viagem", () => {
  it("cai para navio/viagem do BL quando o shipment não informa", async () => {
    db().rows("tracking_shipments")[0]!.vessel = null;
    db().rows("tracking_shipments")[0]!.voyage = null;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.billOfLading?.vessel).toBe("SAN NICOLAS MAERSK");
    expect(detail.billOfLading?.voyage).toBe("639W");
    expect(detail.shipment.vessel).toBe("SAN NICOLAS MAERSK");
    expect(detail.shipment.voyage).toBe("639W");
  });

  it("prefere o navio/viagem do shipment quando existem", async () => {
    const extraction = db().rows("extraction_results")[0]!;
    extraction.payload = blPayload({ vessel: "OUTRO NAVIO", voyage: "999E" });

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.vessel).toBe("SAN NICOLAS MAERSK");
    expect(detail.shipment.voyage).toBe("639W");
  });

  it("expõe a divergência de navio gravada no snapshot do raw", async () => {
    db().rows("tracking_shipments")[0]!.raw = {
      expectedVessel: "SAN NICOLAS MAERSK",
      snapshot: {
        vessel: "MAERSK ESSEX",
        vesselMismatch: {
          expected: "SAN NICOLAS MAERSK",
          found: "MAERSK ESSEX",
        },
      },
    };

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    // O navio exibido é o do portal; o BL continua com o navio original.
    expect(detail.shipment.vessel).toBe("SAN NICOLAS MAERSK");
    expect(detail.billOfLading?.vessel).toBe("SAN NICOLAS MAERSK");
    expect(detail.shipment.vesselMismatch).toEqual({
      expected: "SAN NICOLAS MAERSK",
      found: "MAERSK ESSEX",
    });
  });

  it("não inventa divergência sem `vesselMismatch` no raw", async () => {
    db().rows("tracking_shipments")[0]!.raw = { snapshot: { vessel: "X" } };

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.vesselMismatch).toBeNull();
  });

  it("mantém navio/viagem nulos quando não há BL extraído", async () => {
    db().rows("tracking_shipments")[0]!.vessel = null;
    db().rows("tracking_shipments")[0]!.voyage = null;
    db().rows("documents").length = 0;

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.billOfLading).toBeNull();
    expect(detail.shipment.vessel).toBeNull();
    expect(detail.shipment.voyage).toBeNull();
  });
});

describe("getTrackingShipmentDetail — importação, irmãos e eventos", () => {
  it("resolve a referência da importação e os irmãos da mesma importação", async () => {
    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.import).toEqual({
      id: "imp-1",
      reference: "IMP-001",
      referenceNumber: "IMP-001",
      invoiceNumber: "INV-001",
      blNumber: "276430227",
    });
    expect(detail.siblings.map((row) => row.id)).toEqual([
      "ship-1",
      "ship-container",
    ]);
    expect(detail.siblings[0]?.isCurrent).toBe(true);
    expect(detail.siblings[1]?.isCurrent).toBe(false);
    expect(detail.siblings[1]?.queryTag).toBe("CNTR");
    expect(detail.shipment.queryTag).toBe("BL");
    expect(detail.shipment.carrier).toBe("Maersk");
  });

  it("cai para o BL quando a referência é o próprio BL", async () => {
    db().rows("imports")[0]!.reference_number = "276430227";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.import?.reference).toBe("276430227");
  });

  it("rotula como 'BL master' quando o BL consultado difere do BL do documento", async () => {
    db().rows("imports")[0]!.bl_number = "SASE3388881";
    db().rows("tracking_shipments")[0]!.query_value = "HLCUSHA2502BAXD3";
    db().rows("tracking_shipments")[1]!.query_value = "SASE3388881";
    db().rows("tracking_shipments")[1]!.query_type = "bl";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.queryTag).toBe("BL master");
    expect(detail.shipment.isMasterBl).toBe(true);
    expect(detail.siblings[0]).toMatchObject({
      queryTag: "BL master",
      isMasterBl: true,
    });
    expect(detail.siblings[1]).toMatchObject({
      queryTag: "BL",
      isMasterBl: false,
    });
  });

  it("não rotula como master sem o bl_number da importação", async () => {
    db().rows("imports")[0]!.bl_number = null;
    db().rows("tracking_shipments")[0]!.query_value = "HLCUSHA2502BAXD3";

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.shipment.queryTag).toBe("BL");
    expect(detail.shipment.isMasterBl).toBe(false);
  });

  it("ordena os eventos do mais recente para o mais antigo", async () => {
    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.events.map((event) => event.id)).toEqual([
      "ev-3",
      "ev-2",
      "ev-1",
    ]);
    expect(detail.events[0]).toMatchObject({
      dateIso: "2026-11-10T09:00:00.000Z",
      status: "discharged",
      statusLabel: "Descarregado",
      location: "Santos",
      description: "Discharged at Santos",
      vessel: "SAN NICOLAS MAERSK",
      source: "scrape",
    });
  });

  it("não mistura irmãos nem eventos de outro tenant", async () => {
    db().rows("tracking_shipments").push(
      shipmentRow({
        id: "ship-outro-tenant",
        tenant_id: "tenant-2",
        created_at: "2026-10-20T12:00:00.000Z",
      }),
    );
    db().rows("tracking_events").push(
      eventRow({
        id: "ev-outro-tenant",
        tenant_id: "tenant-2",
        event_at: "2026-11-11T09:00:00.000Z",
        description: "Evento de outro tenant",
      }),
    );

    const detail = await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    expect(detail.siblings.map((row) => row.id)).toEqual([
      "ship-1",
      "ship-container",
    ]);
    expect(detail.events.map((event) => event.id)).not.toContain(
      "ev-outro-tenant",
    );
  });
});

describe("getTrackingShipmentDetail — escopo por tenant", () => {
  it("não encontra shipment de outro tenant", async () => {
    db().rows("tracking_shipments").push(
      shipmentRow({ id: "ship-tenant-2", tenant_id: "tenant-2" }),
    );

    await expect(
      getTrackingShipmentDetail({
        tenantId: TENANT,
        shipmentId: "ship-tenant-2",
      }),
    ).rejects.toBeInstanceOf(TrackingShipmentNotFoundError);
  });

  it("não encontra shipment inexistente", async () => {
    await expect(
      getTrackingShipmentDetail({
        tenantId: TENANT,
        shipmentId: "ship-inexistente",
      }),
    ).rejects.toBeInstanceOf(TrackingShipmentNotFoundError);
  });

  it("filtra todas as consultas pelo tenant informado", async () => {
    await getTrackingShipmentDetail({
      tenantId: TENANT,
      shipmentId: "ship-1",
    });

    for (const query of db().queries) {
      const tenantFilter = query.filters.find(
        (filter) => filter.column === "tenant_id",
      );
      expect(tenantFilter?.value).toBe(TENANT);
    }
  });
});
