import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tracking/run/route";

const mocks = vi.hoisted(() => ({
  enqueueDue: vi.fn(),
  processQueued: vi.fn(),
  firecrawlConfigured: true,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/supabase/read-client", () => ({
  runWithAdminReads: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/tracking/service", () => ({
  enqueueDueTrackingShipments: mocks.enqueueDue,
  processQueuedTrackingJobs: mocks.processQueued,
}));

vi.mock("@/lib/tracking/firecrawl", () => ({
  isFirecrawlConfigured: () => mocks.firecrawlConfigured,
}));

const SECRET = "cron-secret";

function makeRequest(
  options: { authorized?: boolean; url?: string } = {},
): Request {
  return new Request(options.url ?? "http://localhost/api/tracking/run", {
    method: "POST",
    headers:
      options.authorized === false
        ? { authorization: "Bearer errado" }
        : { authorization: `Bearer ${SECRET}` },
  });
}

async function readJson(response: {
  status: number;
  json: () => Promise<unknown>;
}) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mocks.firecrawlConfigured = true;
  mocks.enqueueDue.mockResolvedValue({ queued: 0 });
  mocks.processQueued.mockResolvedValue({ processed: 0, failed: 0 });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/tracking/run", () => {
  it("reenfileira os vencidos antes de drenar a fila", async () => {
    const order: string[] = [];
    mocks.enqueueDue.mockImplementation(async () => {
      order.push("enqueue");
      return { queued: 3 };
    });
    mocks.processQueued.mockImplementation(async () => {
      order.push("process");
      return { processed: 2, failed: 1 };
    });

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, queued: 3, processed: 2, failed: 1 });
    expect(order).toEqual(["enqueue", "process"]);
    expect(mocks.enqueueDue).toHaveBeenCalledWith({ limit: 8 });
    expect(mocks.processQueued).toHaveBeenCalledWith({
      limit: 3,
      worker: "cron",
    });
  });

  it("limita o processamento a 4 jobs por execução", async () => {
    const { status } = await readJson(
      await POST(
        makeRequest({ url: "http://localhost/api/tracking/run?limit=99" }),
      ),
    );

    expect(status).toBe(200);
    expect(mocks.processQueued).toHaveBeenCalledWith({
      limit: 4,
      worker: "cron",
    });
  });

  it("usa lote 3 quando o limite é inválido", async () => {
    await POST(
      makeRequest({ url: "http://localhost/api/tracking/run?limit=abc" }),
    );

    expect(mocks.processQueued).toHaveBeenCalledWith({
      limit: 3,
      worker: "cron",
    });
  });

  it("devolve 503 quando CRON_SECRET não está configurado", async () => {
    delete process.env.CRON_SECRET;

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(503);
    expect(body).toEqual({ error: "CRON_SECRET não configurado" });
    expect(mocks.enqueueDue).not.toHaveBeenCalled();
    expect(mocks.processQueued).not.toHaveBeenCalled();
  });

  it("devolve 401 com segredo errado", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ authorized: false })),
    );

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Não autorizado" });
    expect(mocks.enqueueDue).not.toHaveBeenCalled();
    expect(mocks.processQueued).not.toHaveBeenCalled();
  });

  it("devolve 503 sem FIRECRAWL_API_KEY", async () => {
    mocks.firecrawlConfigured = false;

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(503);
    expect(body).toEqual({
      error: "FIRECRAWL_API_KEY não configurada",
      processed: 0,
      failed: 0,
    });
    expect(mocks.enqueueDue).not.toHaveBeenCalled();
  });

  it("devolve 500 quando o reenfileiramento falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.enqueueDue.mockRejectedValue(new Error("banco fora"));

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "banco fora" });
    expect(mocks.processQueued).not.toHaveBeenCalled();
  });

  it("aceita GET para o Vercel Cron", async () => {
    const { status, body } = await readJson(await GET(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, queued: 0, processed: 0, failed: 0 });
    expect(mocks.enqueueDue).toHaveBeenCalledTimes(1);
  });
});
