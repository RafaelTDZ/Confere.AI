import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTrackingTargets,
  enqueueDueTrackingShipments,
  getPrimaryTrackingShipmentId,
  prioritizeBlShipments,
  processQueuedTrackingJobs,
  refreshTrackingForImport,
} from "@/lib/tracking/service";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  scrape: vi.fn(),
  getImportDetail: vi.fn(),
  syncImportEta: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.admin,
}));

vi.mock("@/lib/documents/imports", () => ({
  getImportDetail: mocks.getImportDetail,
  syncImportEta: mocks.syncImportEta,
}));

vi.mock("@/lib/tracking/firecrawl", () => ({
  isFirecrawlConfigured: () => true,
  estimateFirecrawlCredits: () => 5,
  scrapeWithFirecrawl: mocks.scrape,
}));

vi.mock("@/lib/tracking/usage", () => ({
  consumeTrackingCredits: async () => true,
  getTrackingCreditsUsed: async () => 0,
}));

describe("buildTrackingTargets", () => {
  it("faz do BL consultÃ¡vel a Ãºnica consulta e deixa os containers em link", () => {
    const targets = buildTrackingTargets(
      "bl-123 456",
      {
        containerNumbers: ["CSQU3054383", "CSQU3054384", "CSQU3054383"],
      },
      2,
    );

    expect(targets[0]).toEqual({
      queryType: "bl",
      queryValue: "BL123456",
      containerNumber: null,
    });
    expect(
      targets.filter((target) => target.queryType === "container"),
    ).toEqual([
      {
        queryType: "container",
        queryValue: "CSQU3054383",
        containerNumber: "CSQU3054383",
        strategy: "link",
      },
    ]);
  });

  it("usa o nÃºmero do payload quando a importaÃ§Ã£o nÃ£o tem bl_number", () => {
    const targets = buildTrackingTargets(null, { number: "abc 999" }, 1);
    expect(targets).toEqual([
      { queryType: "bl", queryValue: "ABC999", containerNumber: null },
    ]);
  });

  it("nÃ£o cria alvos sem BL nem containers vÃ¡lidos", () => {
    expect(
      buildTrackingTargets(null, { containerNumbers: ["INVALIDO"] }, 2),
    ).toEqual([]);
  });

  it("mantÃ©m o BL da CMA como link e consulta sÃ³ o primeiro container", () => {
    const targets = buildTrackingTargets(
      "PLISZ4H15403",
      { containerNumbers: ["CAIU9274323", "MSMU4775369"] },
      3,
      "cma",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "PLISZ4H15403",
      strategy: "link",
    });
    expect(targets[1]).toEqual({
      queryType: "container",
      queryValue: "CAIU9274323",
      containerNumber: "CAIU9274323",
    });
    expect(targets[2]).toMatchObject({
      queryType: "container",
      queryValue: "MSMU4775369",
      strategy: "link",
    });
  });

  it("mantÃ©m o BL de casa da MSC como link e consulta sÃ³ o primeiro container", () => {
    const targets = buildTrackingTargets(
      "PLIQD4H06868",
      { containerNumbers: ["MSMU4775369", "TIIU4085593"] },
      3,
      "msc",
    );

    expect(targets[0]).toMatchObject({ queryType: "bl", strategy: "link" });
    expect(targets[1]).toEqual({
      queryType: "container",
      queryValue: "MSMU4775369",
      containerNumber: "MSMU4775369",
    });
    expect(targets[2]).toMatchObject({
      queryType: "container",
      queryValue: "TIIU4085593",
      strategy: "link",
    });
  });

  it("mantÃ©m o BL da Maersk como consulta Ãºnica e deixa o container em link", () => {
    const targets = buildTrackingTargets(
      "276430227",
      { containerNumbers: ["MMAU1421499"] },
      3,
      "maersk",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "276430227",
    });
    expect(targets[0]?.strategy).toBeUndefined();
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "MMAU1421499",
      strategy: "link",
    });
  });

  it("mantÃ©m o BL da COSCO como consulta Ãºnica e deixa o container em link", () => {
    const targets = buildTrackingTargets(
      "COSU6508676460",
      { containerNumbers: ["GAOU7393528"] },
      3,
      "cosco",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "COSU6508676460",
    });
    expect(targets[0]?.strategy).toBeUndefined();
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "GAOU7393528",
      strategy: "link",
    });
  });

  it("rastreia o BL da HMM e deixa o container como link (recarga)", () => {
    const targets = buildTrackingTargets(
      "HMMU72593800",
      { containerNumbers: ["KOCU4320185"] },
      3,
      "hmm",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "HMMU72593800",
    });
    expect(targets[0]?.strategy).toBeUndefined();
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "KOCU4320185",
      strategy: "link",
    });
  });

  it("consulta o 1Âº container quando o BL da HMM Ã© de casa (portal aceita container)", () => {
    const targets = buildTrackingTargets(
      "MSIRYOE261000021",
      { containerNumbers: ["KOCU4320185"] },
      3,
      "hmm",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "MSIRYOE261000021",
      strategy: "link",
    });
    expect(targets[1]).toEqual({
      queryType: "container",
      queryValue: "KOCU4320185",
      containerNumber: "KOCU4320185",
    });
  });

  it("rastreia o BL da ONE e deixa o container como link (recarga)", () => {
    const targets = buildTrackingTargets(
      "ONEYSZPGC3008300",
      { containerNumbers: ["TCKU7925277"] },
      3,
      "one",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "ONEYSZPGC3008300",
    });
    expect(targets[0]?.strategy).toBeUndefined();
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "TCKU7925277",
      strategy: "link",
    });
  });

  it("consulta o 1Âº container quando o BL da ONE Ã© de casa", () => {
    const targets = buildTrackingTargets(
      "PLIQD4H06868",
      { containerNumbers: ["TCKU7925277"] },
      3,
      "one",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "PLIQD4H06868",
      strategy: "link",
    });
    expect(targets[1]).toEqual({
      queryType: "container",
      queryValue: "TCKU7925277",
      containerNumber: "TCKU7925277",
    });
  });

  it("consulta o master BL quando o BL do documento Ã© de casa", () => {
    const targets = buildTrackingTargets(
      "SASE3388881",
      {
        masterBlNumber: " hlcu sha 2502-baxd3 ",
        containerNumbers: ["HLBU9334723"],
      },
      3,
      "hapag",
    );

    expect(targets[0]).toEqual({
      queryType: "bl",
      queryValue: "HLCUSHA2502BAXD3",
      containerNumber: null,
    });
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "HLBU9334723",
      strategy: "link",
    });
  });

  it("consulta o master BL da CMA quando o BL de casa nÃ£o tem CMDU", () => {
    const targets = buildTrackingTargets(
      "PLISZ4H15403",
      {
        masterBlNumber: "CMDU1234567",
        containerNumbers: ["CAIU9274323"],
      },
      3,
      "cma",
    );

    expect(targets[0]).toEqual({
      queryType: "bl",
      queryValue: "CMDU1234567",
      containerNumber: null,
    });
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "CAIU9274323",
      strategy: "link",
    });
  });

  it("ignora o master sem o prefixo do armador e cai para o container", () => {
    const targets = buildTrackingTargets(
      "SASE3388881",
      {
        masterBlNumber: "SASE9999999",
        containerNumbers: ["HLBU9334723"],
      },
      3,
      "hapag",
    );

    expect(targets[0]).toMatchObject({ queryType: "bl", strategy: "link" });
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "HLBU9334723",
    });
    expect(targets[1]?.strategy).toBeUndefined();
  });

  it("usa o master quando o BL do documento nÃ£o foi informado", () => {
    const targets = buildTrackingTargets(
      null,
      { masterBlNumber: "MEDU1234567" },
      3,
      "msc",
    );

    expect(targets).toEqual([
      { queryType: "bl", queryValue: "MEDU1234567", containerNumber: null },
    ]);
  });

  it("infere o armador pelo prefixo do master quando nÃ£o hÃ¡ carrier", () => {
    const targets = buildTrackingTargets(
      "SASE3388881",
      {
        masterBlNumber: "HLCUSHA2502BAXD3",
        containerNumbers: ["HLBU9334723"],
      },
      3,
    );

    expect(targets[0]).toEqual({
      queryType: "bl",
      queryValue: "HLCUSHA2502BAXD3",
      containerNumber: null,
    });
    expect(targets[1]).toMatchObject({
      queryType: "container",
      strategy: "link",
    });
  });

  it("mantÃ©m o BL de casa da Hapag como link e consulta o container", () => {
    const targets = buildTrackingTargets(
      "SASE3388881",
      { containerNumbers: ["HLBU9334723"] },
      3,
      "hapag",
    );

    expect(targets[0]).toMatchObject({ queryType: "bl", strategy: "link" });
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "HLBU9334723",
    });
    expect(targets[1]?.strategy).toBeUndefined();
  });

  it("rastreia o BL master da Hapag (HLCU) como consulta Ãºnica", () => {
    const targets = buildTrackingTargets(
      "HLCUSHA2502BAXD3",
      { containerNumbers: ["HLBU9334723"] },
      3,
      "hapag",
    );

    expect(targets[0]).toMatchObject({
      queryType: "bl",
      queryValue: "HLCUSHA2502BAXD3",
    });
    expect(targets[0]?.strategy).toBeUndefined();
    expect(targets[1]).toMatchObject({
      queryType: "container",
      queryValue: "HLBU9334723",
      strategy: "link",
    });
  });

  it("cria todos os containers da Evergreen para exibiÃ§Ã£o, todos em link", () => {
    const targets = buildTrackingTargets(
      "143600393412",
      {
        containerNumbers: [
          "TLLU7681880",
          "TXGU7226560",
          "EGSU9724678",
          "MAGU5411333",
          "TRHU8727762",
        ],
      },
      3,
      "evergreen",
    );

    const containers = targets.filter(
      (target) => target.queryType === "container",
    );
    expect(containers).toHaveLength(5);
    expect(containers.every((target) => target.strategy === "link")).toBe(true);
    expect(targets[0]?.strategy).toBeUndefined();
  });

  it("deixa BL e containers em link quando a estratÃ©gia do armador Ã© link (OOCL)", () => {
    const targets = buildTrackingTargets(
      "OOLU1234567890",
      { containerNumbers: ["OOLU1234567"] },
      3,
      "oocl",
    );

    expect(targets[0]).toMatchObject({ queryType: "bl", strategy: "link" });
    expect(targets[1]).toMatchObject({
      queryType: "container",
      strategy: "link",
    });
  });
});

describe("prioritizeBlShipments", () => {
  it("coloca o alvo bl na frente dos containers", () => {
    const ordered = prioritizeBlShipments([
      { id: "container-1", query_type: "container" },
      { id: "container-2", query_type: "container" },
      { id: "bl-1", query_type: "bl" },
    ]);

    expect(ordered.map((row) => row.id)).toEqual([
      "bl-1",
      "container-1",
      "container-2",
    ]);
  });

  it("mantÃ©m a ordem quando nÃ£o hÃ¡ alvo bl", () => {
    const ordered = prioritizeBlShipments([
      { id: "container-1", query_type: "container" },
      { id: "container-2", query_type: "container" },
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["container-1", "container-2"]);
  });

  it("nÃ£o muta a lista recebida", () => {
    const shipments = [{ id: "container-1", query_type: "container" }];
    prioritizeBlShipments(shipments);

    expect(shipments).toEqual([{ id: "container-1", query_type: "container" }]);
  });
});

const NOW = new Date("2026-10-28T12:00:00.000Z");
const TENANT = "tenant-a";

function shipmentRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "shipment-1",
    tenant_id: TENANT,
    import_id: "import-1",
    carrier_code: "maersk",
    strategy: "firecrawl",
    query_type: "bl",
    query_value: "276430227",
    container_number: null,
    status: "in_transit",
    next_check_at: NOW.toISOString(),
    ...overrides,
  };
}

function jobRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: `job-${Math.random()}`,
    tenant_id: TENANT,
    shipment_id: "shipment-1",
    strategy: "firecrawl",
    status: "queued",
    ...overrides,
  };
}

describe("enqueueDueTrackingShipments", () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase({ tracking_shipments: [], tracking_jobs: [] });
    mocks.admin = db;
  });

  it("enfileira sÃ³ os vencidos (`next_check_at` nulo ou no passado)", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ id: "nulo", next_check_at: null }),
      shipmentRow({ id: "passado", next_check_at: "2026-10-27T12:00:00.000Z" }),
      shipmentRow({ id: "agora", next_check_at: NOW.toISOString() }),
      shipmentRow({ id: "futuro", next_check_at: "2026-11-04T12:00:00.000Z" }),
    );

    const result = await enqueueDueTrackingShipments({ now: NOW });

    expect(result).toEqual({ queued: 3 });
    expect(
      db
        .rows("tracking_jobs")
        .map((job) => job.shipment_id)
        .sort(),
    ).toEqual(["agora", "nulo", "passado"]);
  });

  it("cria o job `queued` com run_after = now e a estratÃ©gia do shipment", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ id: "http", tenant_id: "tenant-a", strategy: "http" }),
      shipmentRow({ id: "firecrawl", tenant_id: "tenant-b", strategy: "firecrawl" }),
    );

    await enqueueDueTrackingShipments({ now: NOW });

    const jobs = db.rows("tracking_jobs");
    expect(
      jobs.map((job) => ({
        shipment: job.shipment_id,
        tenant: job.tenant_id,
        strategy: job.strategy,
        status: job.status,
        runAfter: job.run_after,
      })),
    ).toEqual([
      {
        shipment: "http",
        tenant: "tenant-a",
        strategy: "http",
        status: "queued",
        runAfter: NOW.toISOString(),
      },
      {
        shipment: "firecrawl",
        tenant: "tenant-b",
        strategy: "firecrawl",
        status: "queued",
        runAfter: NOW.toISOString(),
      },
    ]);
  });

  it("ignora alvos link/manual e status terminais", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ id: "link", strategy: "link", next_check_at: null }),
      shipmentRow({ id: "manual", strategy: "manual", next_check_at: null }),
      shipmentRow({ id: "entregue", status: "delivered", next_check_at: null }),
      shipmentRow({
        id: "vazio-devolvido",
        status: "empty_returned",
        next_check_at: null,
      }),
    );

    const result = await enqueueDueTrackingShipments({ now: NOW });

    expect(result).toEqual({ queued: 0 });
    expect(db.rows("tracking_jobs")).toHaveLength(0);
  });

  it("ignora quem jÃ¡ tem job `queued`/`running` e reaproveita done/failed", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ id: "fila", next_check_at: null }),
      shipmentRow({ id: "rodando", next_check_at: null }),
      shipmentRow({ id: "concluido", next_check_at: null }),
      shipmentRow({ id: "falhou", next_check_at: null }),
    );
    db.rows("tracking_jobs").push(
      jobRow({ id: "job-fila", shipment_id: "fila", status: "queued" }),
      jobRow({ id: "job-rodando", shipment_id: "rodando", status: "running" }),
      jobRow({ id: "job-concluido", shipment_id: "concluido", status: "done" }),
      jobRow({ id: "job-falhou", shipment_id: "falhou", status: "failed" }),
    );

    const result = await enqueueDueTrackingShipments({ now: NOW });

    expect(result).toEqual({ queued: 2 });
    expect(
      db
        .rows("tracking_jobs")
        .slice(4)
        .map((job) => job.shipment_id)
        .sort(),
    ).toEqual(["concluido", "falhou"]);
  });

  it("respeita o limite e prioriza `next_check_at` nulo (nulls first)", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ id: "recente", next_check_at: "2026-10-27T12:00:00.000Z" }),
      shipmentRow({ id: "antigo", next_check_at: "2026-10-20T12:00:00.000Z" }),
      shipmentRow({ id: "sem-data", next_check_at: null }),
    );

    const result = await enqueueDueTrackingShipments({ now: NOW, limit: 2 });

    expect(result).toEqual({ queued: 2 });
    expect(db.rows("tracking_jobs").map((job) => job.shipment_id)).toEqual([
      "sem-data",
      "antigo",
    ]);
  });

  it("usa lote padrÃ£o de 8 vencidos", async () => {
    for (let index = 0; index < 10; index += 1) {
      db.rows("tracking_shipments").push(
        shipmentRow({
          id: `shipment-${index}`,
          next_check_at: new Date(
            NOW.getTime() - (index + 1) * 60_000,
          ).toISOString(),
        }),
      );
    }

    const result = await enqueueDueTrackingShipments({ now: NOW });

    expect(result).toEqual({ queued: 8 });
  });

  it("devolve zero quando nada venceu", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ next_check_at: "2026-11-04T12:00:00.000Z" }),
    );

    const result = await enqueueDueTrackingShipments({ now: NOW });

    expect(result).toEqual({ queued: 0 });
    expect(db.rows("tracking_jobs")).toHaveLength(0);
  });

  it("propaga falha ao listar os vencidos", async () => {
    db.failNext(
      { message: "banco fora" },
      { table: "tracking_shipments", operation: "select" },
    );

    await expect(enqueueDueTrackingShipments({ now: NOW })).rejects.toThrow(
      "Falha ao listar rastreios vencidos: banco fora",
    );
  });
});

/** Resposta do Firecrawl sem eventos: forÃ§a o caminho de ETA no BL. */
function firecrawlResult(eta: string | null = "2026-11-14") {
  return {
    ok: true,
    mode: "json" as const,
    json: {
      found: true,
      vessel: "SAN NICOLAS MAERSK",
      voyage: "639W",
      eta,
      containers: [],
      notes: null,
    },
    markdown: null,
    statusCode: 200,
    creditsCost: 5,
    errorCode: null,
    errorMessage: null,
  };
}

/** Documento de BL + extraÃ§Ã£o mais recente com o payload do formulÃ¡rio. */
function seedBlExtraction(db: FakeSupabase, eta: string | null): void {
  db.rows("documents").push({
    id: "doc-bl",
    tenant_id: TENANT,
    import_id: "import-1",
    doc_type: "bill_of_lading",
    created_at: "2026-10-20T10:00:00.000Z",
  });
  db.rows("extraction_results").push({
    id: "extraction-1",
    tenant_id: TENANT,
    document_id: "doc-bl",
    model: "test",
    payload: { number: "276430227", eta },
    created_at: "2026-10-20T10:05:00.000Z",
  });
}

/** Job `queued` jÃ¡ reservado pelo claim atÃ´mico da fila. */
function seedQueuedJob(db: FakeSupabase): void {
  const job = jobRow({ id: "job-1", shipment_id: "shipment-1" });
  db.rows("tracking_jobs").push(job);
  db.onRpc("claim_tracking_jobs", { data: [job] });
}

describe("refreshTrackingForImport", () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase({ tracking_shipments: [], tracking_jobs: [] });
    mocks.admin = db;
    mocks.scrape.mockReset();
    mocks.scrape.mockResolvedValue(firecrawlResult());
    mocks.getImportDetail.mockReset();
    mocks.getImportDetail.mockResolvedValue({
      bl_number: "276430227",
      bl: {
        number: "276430227",
        carrier: "Maersk",
        vessel: "SAN NICOLAS MAERSK",
        containerNumbers: ["MMAU1421499", "MSMU4775369"],
      },
    });
  });

  it("processa um Ãºnico alvo pela fila e nÃ£o deixa job `queued`", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        next_check_at: "2026-11-04T12:00:00.000Z",
      }),
      shipmentRow({
        id: "container-1",
        strategy: "link",
        query_type: "container",
        query_value: "MMAU1421499",
        container_number: "MMAU1421499",
        next_check_at: null,
      }),
      shipmentRow({
        id: "container-2",
        strategy: "link",
        query_type: "container",
        query_value: "MSMU4775369",
        container_number: "MSMU4775369",
        next_check_at: null,
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      // `next_check_at` futuro: o botÃ£o forÃ§a a consulta mesmo assim.
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    const jobs = db.rows("tracking_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ shipment_id: "bl", status: "done" });
    expect(jobs.some((job) => job.status === "queued")).toBe(false);
  });

  it("sem force nÃ£o enfileira quando o alvo nÃ£o estÃ¡ vencido", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ next_check_at: "2026-11-04T12:00:00.000Z" }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
    });

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(db.rows("tracking_jobs")).toHaveLength(0);
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(mocks.getImportDetail).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("consulta o primeiro container quando o BL Ã© link (CMA/MSC)", async () => {
    mocks.getImportDetail.mockResolvedValue({
      bl_number: "PLISZ4H15403",
      bl: {
        number: "PLISZ4H15403",
        carrier: "CMA CGM",
        vessel: "CMA CGM KRYPTON",
        containerNumbers: ["CAIU9274323", "MSMU4775369"],
      },
    });
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        carrier_code: "cma",
        strategy: "link",
        query_value: "PLISZ4H15403",
        next_check_at: null,
      }),
      shipmentRow({
        id: "container-1",
        carrier_code: "cma",
        strategy: "link",
        query_type: "container",
        query_value: "CAIU9274323",
        container_number: "CAIU9274323",
        next_check_at: null,
      }),
      shipmentRow({
        id: "container-2",
        carrier_code: "cma",
        strategy: "link",
        query_type: "container",
        query_value: "MSMU4775369",
        container_number: "MSMU4775369",
        next_check_at: null,
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    const shipments = db.rows("tracking_shipments");
    // O BL continua `link`; sÃ³ o primeiro container Ã© promovido e consultado.
    expect(shipments.find((row) => row.id === "bl")).toMatchObject({
      strategy: "link",
    });
    expect(shipments.find((row) => row.id === "container-1")).toMatchObject({
      strategy: "firecrawl",
      query_value: "CAIU9274323",
    });
    expect(shipments.find((row) => row.id === "container-2")).toMatchObject({
      strategy: "link",
    });
    expect(
      db.rows("tracking_jobs").filter((job) => job.status === "queued"),
    ).toHaveLength(0);
  });

  it("consulta o BL master e rebaixa o BL de casa Ã³rfÃ£o", async () => {
    mocks.getImportDetail.mockResolvedValue({
      bl_number: "SASE3388881",
      bl: {
        number: "SASE3388881",
        masterBlNumber: "HLCUSHA2502BAXD3",
        carrier: "Hapag-Lloyd",
        vessel: "SAN NICOLAS MAERSK",
        containerNumbers: ["HLBU9334723"],
      },
    });
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "house-bl",
        carrier_code: "hapag",
        strategy: "firecrawl",
        query_value: "SASE3388881",
        next_check_at: null,
      }),
    );
    db.rows("tracking_jobs").push(
      jobRow({
        id: "job-house",
        shipment_id: "house-bl",
        status: "queued",
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    const shipments = db.rows("tracking_shipments");
    expect(
      shipments.find((row) => row.query_value === "HLCUSHA2502BAXD3"),
    ).toMatchObject({ query_type: "bl", strategy: "firecrawl" });
    expect(shipments.find((row) => row.id === "house-bl")).toMatchObject({
      strategy: "link",
      next_check_at: null,
    });
    expect(
      db.rows("tracking_jobs").find((job) => job.id === "job-house"),
    ).toMatchObject({ status: "done", last_error: "single_query_target" });
    expect(
      db.rows("tracking_jobs").filter((job) => job.status === "queued"),
    ).toHaveLength(0);
  });

  it("rebaixa containers antigos e encerra os jobs Ã³rfÃ£os antes de consultar", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ id: "bl", next_check_at: null }),
      shipmentRow({
        id: "legacy-container",
        query_type: "container",
        query_value: "MMAU1421499",
        container_number: "MMAU1421499",
        next_check_at: null,
      }),
    );
    db.rows("tracking_jobs").push(
      jobRow({
        id: "job-legacy",
        shipment_id: "legacy-container",
        status: "queued",
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(
      db.rows("tracking_shipments").find((row) => row.id === "legacy-container"),
    ).toMatchObject({ strategy: "link", next_check_at: null });
    expect(
      db.rows("tracking_jobs").find((job) => job.id === "job-legacy"),
    ).toMatchObject({ status: "done", last_error: "single_query_target" });
    expect(
      db.rows("tracking_jobs").filter((job) => job.status === "queued"),
    ).toHaveLength(0);
  });

  it("nÃ£o consulta de novo dentro do cooldown, nem com force", async () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "30");
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        next_check_at: "2026-11-04T12:00:00.000Z",
        fetched_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toMatchObject({ processed: 0, failed: 0, skipped: "cooldown" });
    // Faltam ~25 min dos 30: o retry acompanha o relÃ³gio do servidor.
    expect(result.retryAfterSeconds).toBeGreaterThan(24 * 60);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(25 * 60);
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(mocks.getImportDetail).not.toHaveBeenCalled();
    expect(db.rows("tracking_jobs")).toHaveLength(0);
  });

  it("aplica o cooldown quando a Ãºltima consulta falhou", async () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "30");
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        status: "not_found",
        error_code: "maersk_no_result",
        fetched_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toMatchObject({
      processed: 0,
      failed: 0,
      skipped: "cooldown",
    });
    expect(mocks.scrape).not.toHaveBeenCalled();
  });

  it("consulta quando o cooldown expirou", async () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "30");
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        next_check_at: "2026-11-04T12:00:00.000Z",
        fetched_at: new Date(Date.now() - 31 * 60_000).toISOString(),
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
  });

  it("consulta quando o alvo nunca foi buscado (`fetched_at` nulo)", async () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "30");
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        next_check_at: "2026-11-04T12:00:00.000Z",
        fetched_at: null,
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
  });

  it("cooldown 0 desativa o cache curto", async () => {
    vi.stubEnv("TRACKING_REFRESH_COOLDOWN_MINUTES", "0");
    db.rows("tracking_shipments").push(
      shipmentRow({
        id: "bl",
        next_check_at: "2026-11-04T12:00:00.000Z",
        fetched_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    const result = await refreshTrackingForImport({
      tenantId: TENANT,
      importId: "import-1",
      force: true,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
  });
});

describe("processQueuedTrackingJobs â€” recuperaÃ§Ã£o de job `running` Ã³rfÃ£o", () => {
  let db: FakeSupabase;

  const EXPIRED_LOCK = new Date(Date.now() - 60_000).toISOString();
  const VALID_LOCK = new Date(Date.now() + 10 * 60_000).toISOString();

  beforeEach(() => {
    db = new FakeSupabase({ tracking_shipments: [], tracking_jobs: [] });
    mocks.admin = db;
    mocks.scrape.mockReset();
    mocks.scrape.mockResolvedValue(firecrawlResult());
    db.rows("tracking_shipments").push(shipmentRow({ id: "bl" }));
  });

  it("reivindica job `running` com lock expirado e tentativas restantes", async () => {
    db.rows("tracking_jobs").push(
      jobRow({
        id: "job-orphan",
        shipment_id: "bl",
        status: "running",
        attempts: 1,
        locked_until: EXPIRED_LOCK,
        locked_by: "cron-morto",
      }),
    );

    const result = await processQueuedTrackingJobs({
      importId: "import-1",
      limit: 1,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(db.rows("tracking_jobs")[0]).toMatchObject({
      id: "job-orphan",
      status: "done",
      locked_by: "cron",
    });
  });

  it("marca `failed` o job `running` com tentativas esgotadas", async () => {
    db.rows("tracking_jobs").push(
      jobRow({
        id: "job-exhausted",
        shipment_id: "bl",
        status: "running",
        attempts: 3,
        locked_until: EXPIRED_LOCK,
      }),
    );

    const result = await processQueuedTrackingJobs({
      importId: "import-1",
      limit: 1,
    });

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(db.rows("tracking_jobs")[0]).toMatchObject({
      status: "failed",
      last_error: "stale_timeout",
      locked_until: null,
    });
  });

  it("ignora job `running` com lock vÃ¡lido", async () => {
    db.rows("tracking_jobs").push(
      jobRow({
        id: "job-busy",
        shipment_id: "bl",
        status: "running",
        attempts: 1,
        locked_until: VALID_LOCK,
        locked_by: "outro-worker",
      }),
    );

    const result = await processQueuedTrackingJobs({
      importId: "import-1",
      limit: 1,
    });

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(db.rows("tracking_jobs")[0]).toMatchObject({
      status: "running",
      locked_by: "outro-worker",
    });
  });

  it("continua reivindicando job `queued` vencido", async () => {
    db.rows("tracking_jobs").push(
      jobRow({
        id: "job-queued",
        shipment_id: "bl",
        status: "queued",
        run_after: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    const result = await processQueuedTrackingJobs({
      importId: "import-1",
      limit: 1,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(db.rows("tracking_jobs")[0]).toMatchObject({ status: "done" });
  });
});

describe("processQueuedTrackingJobs â€” ETA do BL", () => {
  let db: FakeSupabase;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new FakeSupabase({
      tracking_shipments: [],
      tracking_jobs: [],
      documents: [],
      extraction_results: [],
    });
    mocks.admin = db;
    mocks.scrape.mockReset();
    mocks.scrape.mockResolvedValue(firecrawlResult());
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("preenche o eta do payload do BL quando estÃ¡ vazio", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ status: "pending", eta: null, raw: {} }),
    );
    seedBlExtraction(db, null);
    seedQueuedJob(db);

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(db.rows("extraction_results")[0]?.payload).toEqual({
      number: "276430227",
      eta: "14/11/2026",
    });
    expect(db.rows("tracking_shipments")[0]?.eta).toBe("2026-11-14");
  });

  it("nÃ£o sobrescreve o ETA jÃ¡ preenchido (ediÃ§Ã£o manual)", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ status: "pending", eta: null, raw: {} }),
    );
    seedBlExtraction(db, "05/11/2026");
    seedQueuedJob(db);

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(db.rows("extraction_results")[0]?.payload).toMatchObject({
      eta: "05/11/2026",
    });
  });

  it("preenche o ETA do BL a partir do container consultado (CMA/MSC)", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "pending",
        eta: null,
        query_type: "container",
        query_value: "MMAU1421499",
        container_number: "MMAU1421499",
        raw: {},
      }),
    );
    seedBlExtraction(db, null);
    seedQueuedJob(db);

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(db.rows("extraction_results")[0]?.payload).toEqual({
      number: "276430227",
      eta: "14/11/2026",
    });
    // O ETA do container consultado representa o embarque inteiro.
    expect(db.rows("tracking_shipments")[0]?.eta).toBe("2026-11-14");
  });

  it("nÃ£o preenche o ETA do BL a partir de container `link`", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "pending",
        eta: null,
        strategy: "link",
        query_type: "container",
        query_value: "MMAU1421499",
        container_number: "MMAU1421499",
        raw: {},
      }),
    );
    seedBlExtraction(db, null);
    seedQueuedJob(db);

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    // Container `link` nÃ£o Ã© consultado nem preenche o formulÃ¡rio.
    expect(mocks.scrape).not.toHaveBeenCalled();
    expect(db.rows("extraction_results")[0]?.payload).toMatchObject({
      eta: null,
    });
    expect(db.rows("tracking_jobs")[0]?.status).toBe("done");
  });

  it("mantÃ©m o shipment atualizado quando a gravaÃ§Ã£o do ETA falha", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({ status: "pending", eta: null, raw: {} }),
    );
    seedBlExtraction(db, null);
    seedQueuedJob(db);
    db.failNext(
      { message: "banco fora" },
      { table: "extraction_results", operation: "update" },
    );

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    const shipment = db.rows("tracking_shipments")[0];
    expect(shipment?.status).toBe("pending");
    expect(shipment?.eta).toBe("2026-11-14");
    expect(shipment?.fetched_at).toBeTruthy();
    expect(shipment?.error_code).toBeNull();
    expect(db.rows("tracking_jobs")[0]?.status).toBe("done");
    // O payload nÃ£o foi gravado, mas o processamento seguiu.
    expect(db.rows("extraction_results")[0]?.payload).toMatchObject({
      eta: null,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[tracking] falha ao preencher ETA do BL:",
      "Falha ao salvar ETA do BL: banco fora",
    );
  });
});

/** Resposta do Firecrawl sem resultado no portal (`not_found`). */
function firecrawlNotFoundResult() {
  return {
    ok: true,
    mode: "json" as const,
    json: {
      found: false,
      vessel: null,
      voyage: null,
      eta: null,
      containers: [],
      notes: "No data found",
    },
    markdown: null,
    statusCode: 200,
    creditsCost: 5,
    errorCode: null,
    errorMessage: null,
  };
}

/** Snapshot do portal com navio/evento (base da divergÃªncia de navio). */
function firecrawlVesselResult(vessel: string) {
  return {
    ...firecrawlResult("2026-11-20"),
    json: {
      found: true,
      vessel,
      voyage: "0TX9W1",
      eta: "2026-11-20",
      containers: [
        {
          number: "MMAU1421499",
          status: "In transit",
          events: [
            {
              date: "2026-10-15",
              location: "Santos",
              description: "Vessel departure",
            },
          ],
        },
      ],
      notes: null,
    },
  };
}

describe("processQueuedTrackingJobs â€” divergÃªncia de navio", () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase({ tracking_shipments: [], tracking_jobs: [] });
    mocks.admin = db;
    mocks.scrape.mockReset();
  });

  it("aceita rollover, persiste vesselMismatch no raw e nÃ£o repete a consulta", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        carrier_code: "maersk",
        strategy: "firecrawl",
        eta: null,
        raw: { expectedVessel: "CMA CGM ATLANTIC" },
      }),
    );
    mocks.scrape.mockResolvedValue(firecrawlVesselResult("CMA CGM SANTOS"));
    seedQueuedJob(db);

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    // DivergÃªncia de navio nÃ£o Ã© "placeholder": o retry da Maersk nÃ£o dispara.
    expect(mocks.scrape).toHaveBeenCalledTimes(1);

    const shipment = db.rows("tracking_shipments")[0];
    expect(shipment).toMatchObject({
      status: "in_transit",
      vessel: "CMA CGM SANTOS",
      eta: "2026-11-20",
      error_code: null,
    });
    expect(shipment?.raw).toMatchObject({
      expectedVessel: "CMA CGM ATLANTIC",
      snapshot: {
        vesselMismatch: {
          expected: "CMA CGM ATLANTIC",
          found: "CMA CGM SANTOS",
        },
      },
    });
    expect(db.rows("tracking_jobs")[0]?.status).toBe("done");
  });
});

describe("processQueuedTrackingJobs â€” fallback BL not_found â†’ 1Âº container", () => {
  let db: FakeSupabase;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new FakeSupabase({
      tracking_shipments: [],
      tracking_jobs: [],
      documents: [],
      extraction_results: [],
    });
    mocks.admin = db;
    mocks.scrape.mockReset();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  function seedBlJob(shipmentId: string): void {
    const job = jobRow({ id: "job-bl", shipment_id: shipmentId });
    db.rows("tracking_jobs").push(job);
    db.onRpc("claim_tracking_jobs", { data: [job] });
  }

  function blRow(overrides: FakeRow = {}): FakeRow {
    return shipmentRow({
      id: "bl",
      carrier_code: "cosco",
      query_type: "bl",
      query_value: "COSU6508676460",
      status: "pending",
      eta: null,
      raw: {},
      created_at: "2026-10-20T10:00:00.000Z",
      ...overrides,
    });
  }

  function containerRow(
    id: string,
    number: string,
    overrides: FakeRow = {},
  ): FakeRow {
    return shipmentRow({
      id,
      carrier_code: "cosco",
      strategy: "link",
      query_type: "container",
      query_value: number,
      container_number: number,
      status: "pending",
      eta: null,
      next_check_at: null,
      raw: {},
      ...overrides,
    });
  }

  it("promove e consulta uma Ãºnica vez o primeiro container, preenchendo o ETA do BL", async () => {
    db.rows("tracking_shipments").push(
      blRow(),
      // Ordem de inserÃ§Ã£o invertida: vale `created_at asc`.
      containerRow("container-2", "GAOU7393529", {
        created_at: "2026-10-20T10:02:00.000Z",
      }),
      containerRow("container-1", "GAOU7393528", {
        created_at: "2026-10-20T10:01:00.000Z",
      }),
    );
    seedBlExtraction(db, null);
    seedBlJob("bl");
    mocks.scrape
      .mockResolvedValueOnce(firecrawlNotFoundResult())
      .mockResolvedValueOnce(firecrawlResult("2026-11-14"));

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    // 1Âª consulta no BL, 2Âª e Ãºnica no container promovido.
    expect(mocks.scrape).toHaveBeenCalledTimes(2);
    expect(mocks.scrape.mock.calls[1]?.[0]).toMatchObject({
      url: expect.stringContaining("GAOU7393528"),
    });

    const shipments = db.rows("tracking_shipments");
    expect(shipments.find((row) => row.id === "bl")).toMatchObject({
      strategy: "link",
      next_check_at: null,
      status: "not_found",
    });
    expect(shipments.find((row) => row.id === "container-1")).toMatchObject({
      strategy: "firecrawl",
      query_value: "GAOU7393528",
      status: "pending",
    });
    // Demais containers seguem `link` (sem consulta).
    expect(shipments.find((row) => row.id === "container-2")).toMatchObject({
      strategy: "link",
    });

    // O ETA do container consultado preenche o formulÃ¡rio do BL.
    expect(db.rows("extraction_results")[0]?.payload).toEqual({
      number: "276430227",
      eta: "14/11/2026",
    });

    const jobs = db.rows("tracking_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ shipment_id: "bl", status: "done" });
  });

  it("nÃ£o faz nada quando o BL nÃ£o Ã© encontrado e nÃ£o hÃ¡ containers", async () => {
    db.rows("tracking_shipments").push(blRow());
    seedBlExtraction(db, null);
    seedBlJob("bl");
    mocks.scrape.mockResolvedValue(firecrawlNotFoundResult());

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(db.rows("tracking_shipments")).toHaveLength(1);
    expect(db.rows("tracking_shipments")[0]).toMatchObject({
      id: "bl",
      strategy: "firecrawl",
      status: "not_found",
    });
    expect(db.rows("extraction_results")[0]?.payload).toMatchObject({
      eta: null,
    });
  });

  it("nÃ£o consulta outro container quando jÃ¡ existe um consultÃ¡vel", async () => {
    db.rows("tracking_shipments").push(
      blRow(),
      containerRow("container-1", "GAOU7393528", {
        strategy: "firecrawl",
        next_check_at: "2026-11-04T12:00:00.000Z",
        created_at: "2026-10-20T10:01:00.000Z",
      }),
      containerRow("container-2", "GAOU7393529", {
        created_at: "2026-10-20T10:02:00.000Z",
      }),
    );
    seedBlJob("bl");
    mocks.scrape.mockResolvedValue(firecrawlNotFoundResult());

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    const shipments = db.rows("tracking_shipments");
    expect(shipments.find((row) => row.id === "container-1")).toMatchObject({
      strategy: "firecrawl",
    });
    expect(shipments.find((row) => row.id === "container-2")).toMatchObject({
      strategy: "link",
    });
    expect(shipments.find((row) => row.id === "bl")).toMatchObject({
      strategy: "firecrawl",
    });
  });

  it("nÃ£o faz fallback quando o BL Ã© encontrado", async () => {
    db.rows("tracking_shipments").push(
      blRow(),
      containerRow("container-1", "GAOU7393528", {
        created_at: "2026-10-20T10:01:00.000Z",
      }),
    );
    seedBlExtraction(db, null);
    seedBlJob("bl");
    mocks.scrape.mockResolvedValue(firecrawlResult());

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(mocks.scrape).toHaveBeenCalledTimes(1);
    expect(db.rows("tracking_shipments")[1]).toMatchObject({
      id: "container-1",
      strategy: "link",
    });
    expect(db.rows("extraction_results")[0]?.payload).toEqual({
      number: "276430227",
      eta: "14/11/2026",
    });
  });

  it("engole e loga a falha do fallback mantendo o BL salvo", async () => {
    db.rows("tracking_shipments").push(
      blRow(),
      containerRow("container-1", "GAOU7393528", {
        created_at: "2026-10-20T10:01:00.000Z",
      }),
    );
    seedBlJob("bl");
    mocks.scrape
      .mockResolvedValueOnce(firecrawlNotFoundResult())
      .mockRejectedValueOnce(new Error("portal fora"));

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    const bl = db.rows("tracking_shipments").find((row) => row.id === "bl");
    expect(bl).toMatchObject({ status: "not_found" });
    expect(bl?.fetched_at).toBeTruthy();
    expect(bl?.error_code).toBeNull();
    expect(db.rows("tracking_jobs")[0]?.status).toBe("done");
    expect(consoleError).toHaveBeenCalledWith(
      "[tracking] fallback de container falhou:",
      "portal fora",
    );
  });
});

/** Resposta do Firecrawl com eventos de container (base dos marcos). */
function firecrawlEventsResult(params: {
  eta?: string | null;
  events?: Array<{ date: string; description: string; location?: string | null }>;
}) {
  return {
    ok: true,
    mode: "json" as const,
    json: {
      found: true,
      vessel: "SAN NICOLAS MAERSK",
      voyage: "639W",
      eta: params.eta ?? null,
      containers: [
        {
          number: "MMAU1421499",
          status: null,
          events: (params.events ?? []).map((event) => ({
            date: event.date,
            description: event.description,
            location: event.location ?? null,
          })),
        },
      ],
      notes: null,
    },
    markdown: null,
    statusCode: 200,
    creditsCost: 5,
    errorCode: null,
    errorMessage: null,
  };
}

describe("processQueuedTrackingJobs â€” marcos do embarque", () => {
  let db: FakeSupabase;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new FakeSupabase({
      tracking_shipments: [],
      tracking_jobs: [],
      documents: [],
      extraction_results: [],
    });
    mocks.admin = db;
    mocks.scrape.mockReset();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  function seedJob(id: string): void {
    const job = jobRow({ id, shipment_id: "shipment-1" });
    db.rows("tracking_jobs").push(job);
    db.onRpc("claim_tracking_jobs", { data: [job] });
  }

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("grava o eta_original sÃ³ na primeira consulta", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "pending",
        eta: null,
        eta_original: null,
        ata: null,
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(firecrawlEventsResult({ eta: "2026-11-14" }));
    seedJob("job-1");

    const first = await processQueuedTrackingJobs({ limit: 1 });

    expect(first).toEqual({ processed: 1, failed: 0 });
    expect(db.rows("tracking_shipments")[0]?.eta_original).toBe("2026-11-14");

    // O armador mudou o ETA: o marco original nÃ£o pode ser sobrescrito.
    mocks.scrape.mockResolvedValue(firecrawlEventsResult({ eta: "2026-11-20" }));
    seedJob("job-2");

    const second = await processQueuedTrackingJobs({ limit: 1 });

    expect(second).toEqual({ processed: 1, failed: 0 });
    const shipment = db.rows("tracking_shipments")[0];
    expect(shipment?.eta).toBe("2026-11-20");
    expect(shipment?.eta_original).toBe("2026-11-14");
  });

  it("grava o ata no evento de chegada/descarga", async () => {
    const arrival = daysAgo(2);
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "in_transit",
        eta: "2026-11-12",
        eta_original: "2026-11-10",
        ata: null,
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(
      firecrawlEventsResult({
        eta: "2026-11-12",
        events: [
          {
            date: arrival,
            location: "Santos",
            description: "Discharged at Santos",
          },
          {
            date: daysAgo(20),
            location: "Shekou",
            description: "Loaded on board",
          },
        ],
      }),
    );
    seedJob("job-ata");

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    const shipment = db.rows("tracking_shipments")[0];
    expect(shipment?.ata).toBe(arrival.slice(0, 10));
    expect(shipment?.eta_original).toBe("2026-11-10");
  });

  it("nÃ£o sobrescreve marcos jÃ¡ gravados", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "in_transit",
        eta: "2026-11-20",
        eta_original: "2026-11-10",
        ata: "2026-11-03",
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(
      firecrawlEventsResult({
        eta: "2026-11-25",
        events: [
          {
            date: daysAgo(1),
            location: "Santos",
            description: "Arrived at Santos",
          },
        ],
      }),
    );
    seedJob("job-preserva");

    await processQueuedTrackingJobs({ limit: 1 });

    const shipment = db.rows("tracking_shipments")[0];
    expect(shipment?.eta).toBe("2026-11-25");
    expect(shipment?.eta_original).toBe("2026-11-10");
    expect(shipment?.ata).toBe("2026-11-03");
  });

  it("ignora chegada/descarga em porto de transbordo (T/S)", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "in_transit",
        eta: "2026-12-03",
        eta_original: null,
        ata: null,
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(
      firecrawlEventsResult({
        eta: "2026-12-03",
        events: [
          {
            date: daysAgo(2),
            location: "BUSAN",
            description: "Vessel Arrival at T/S Port",
          },
          {
            date: daysAgo(2),
            location: "BUSAN",
            description: "Vessel Discharged at T/S Port",
          },
        ],
      }),
    );
    seedJob("job-ts");

    await processQueuedTrackingJobs({ limit: 1 });

    expect(db.rows("tracking_shipments")[0]?.ata).toBeNull();
  });

  it("usa a chegada real mesmo com um transbordo mais recente", async () => {
    const arrival = daysAgo(3);
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "in_transit",
        eta: "2026-12-03",
        eta_original: null,
        ata: null,
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(
      firecrawlEventsResult({
        eta: "2026-12-03",
        events: [
          {
            date: daysAgo(1),
            location: "Busan (T/S)",
            description: "Vessel Discharged",
          },
          {
            date: arrival,
            location: "Santos",
            description: "Discharged at Santos",
          },
        ],
      }),
    );
    seedJob("job-ts-real");

    await processQueuedTrackingJobs({ limit: 1 });

    expect(db.rows("tracking_shipments")[0]?.ata).toBe(arrival.slice(0, 10));
  });

  it("ignora evento de chegada futuro (previsÃ£o nÃ£o Ã© ATA)", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "in_transit",
        eta: "2026-11-12",
        eta_original: null,
        ata: null,
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(
      firecrawlEventsResult({
        eta: "2026-11-12",
        events: [
          {
            date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
            description: "Arrived at Santos",
          },
        ],
      }),
    );
    seedJob("job-futuro");

    await processQueuedTrackingJobs({ limit: 1 });

    expect(db.rows("tracking_shipments")[0]?.ata).toBeNull();
    expect(db.rows("tracking_shipments")[0]?.eta_original).toBe("2026-11-12");
  });

  it("nÃ£o derruba o rastreio quando a gravaÃ§Ã£o dos marcos falha", async () => {
    db.rows("tracking_shipments").push(
      shipmentRow({
        status: "pending",
        eta: null,
        eta_original: null,
        ata: null,
        raw: {},
      }),
    );
    mocks.scrape.mockResolvedValue(firecrawlEventsResult({ eta: "2026-11-14" }));
    seedJob("job-falha");
    db.failNext(
      { message: "banco fora" },
      {
        table: "tracking_shipments",
        operation: "update",
        match: (query) => {
          const patch = query.payload;
          return (
            typeof patch === "object" &&
            patch !== null &&
            !Array.isArray(patch) &&
            ("eta_original" in patch || "ata" in patch)
          );
        },
      },
    );

    const result = await processQueuedTrackingJobs({ limit: 1 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    const shipment = db.rows("tracking_shipments")[0];
    expect(shipment?.eta).toBe("2026-11-14");
    expect(shipment?.eta_original).toBeNull();
    expect(shipment?.fetched_at).toBeTruthy();
    expect(db.rows("tracking_jobs")[0]?.status).toBe("done");
    expect(consoleError).toHaveBeenCalledWith(
      "[tracking] falha ao gravar marcos do embarque:",
      "Falha ao salvar marcos do embarque: banco fora",
    );
  });
});

describe("getPrimaryTrackingShipmentId", () => {
  function primaryRow(
    id: string,
    overrides: FakeRow = {},
  ): FakeRow {
    return {
      id,
      tenant_id: "tenant-1",
      import_id: "import-1",
      strategy: "firecrawl",
      last_event_at: null,
      created_at: "2026-10-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("prioriza alvo consultÃ¡vel e, dentro do grupo, o evento mais recente", async () => {
    const db = new FakeSupabase({
      tracking_shipments: [
        primaryRow("bl", {
          last_event_at: "2026-10-20T10:00:00.000Z",
          created_at: "2026-10-03T00:00:00.000Z",
        }),
        primaryRow("container", {
          strategy: "http",
          last_event_at: "2026-10-25T10:00:00.000Z",
          created_at: "2026-10-02T00:00:00.000Z",
        }),
        // `link` nÃ£o Ã© consultado: fica por Ãºltimo mesmo com evento mais novo.
        primaryRow("link", {
          strategy: "link",
          last_event_at: "2026-10-28T10:00:00.000Z",
          created_at: "2026-10-01T00:00:00.000Z",
        }),
      ],
    });
    mocks.admin = db;

    await expect(
      getPrimaryTrackingShipmentId({
        tenantId: "tenant-1",
        importId: "import-1",
      }),
    ).resolves.toBe("container");
  });

  it("mantÃ©m a ordem de criaÃ§Ã£o quando o Ãºltimo evento empata", async () => {
    const sameEvent = "2026-10-20T10:00:00.000Z";
    const db = new FakeSupabase({
      tracking_shipments: [
        primaryRow("segundo", {
          last_event_at: sameEvent,
          created_at: "2026-10-02T00:00:00.000Z",
        }),
        primaryRow("primeiro", {
          last_event_at: sameEvent,
          created_at: "2026-10-01T00:00:00.000Z",
        }),
      ],
    });
    mocks.admin = db;

    await expect(
      getPrimaryTrackingShipmentId({
        tenantId: "tenant-1",
        importId: "import-1",
      }),
    ).resolves.toBe("primeiro");
  });

  it("ignora shipments de outra importaÃ§Ã£o/tenant e retorna null sem rastreio", async () => {
    const db = new FakeSupabase({
      tracking_shipments: [
        primaryRow("outra-importacao", {
          import_id: "import-2",
          last_event_at: "2026-10-28T10:00:00.000Z",
        }),
        primaryRow("outro-tenant", {
          tenant_id: "tenant-2",
          last_event_at: "2026-10-28T10:00:00.000Z",
        }),
      ],
    });
    mocks.admin = db;

    await expect(
      getPrimaryTrackingShipmentId({
        tenantId: "tenant-1",
        importId: "import-1",
      }),
    ).resolves.toBeNull();

    await expect(
      getPrimaryTrackingShipmentId({
        tenantId: "tenant-1",
        importId: "import-2",
      }),
    ).resolves.toBe("outra-importacao");
  });
});

