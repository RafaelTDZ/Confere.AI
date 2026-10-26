import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GET,
  POST,
} from "@/app/api/ai/jobs/run/route";

const mocks = vi.hoisted(() => ({
  processNextAiJob: vi.fn(),
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

vi.mock("@/lib/documents/ai-worker", () => ({
  processNextAiJob: mocks.processNextAiJob,
}));

const SECRET = "cron-secret";

function makeRequest(options: { authorized?: boolean } = {}) {
  return new Request("http://localhost/api/ai/jobs/run", {
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
  mocks.processNextAiJob.mockResolvedValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

describe("POST /api/ai/jobs/run", () => {
  it("processa até 3 jobs da fila", async () => {
    mocks.processNextAiJob
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual({ processed: 2 });
    expect(mocks.processNextAiJob).toHaveBeenCalledTimes(3);
  });

  it("para no limite de 3 jobs por execução", async () => {
    mocks.processNextAiJob.mockResolvedValue(true);

    const { body } = await readJson(await POST(makeRequest()));

    expect(body).toEqual({ processed: 3 });
    expect(mocks.processNextAiJob).toHaveBeenCalledTimes(3);
  });

  it("devolve 503 quando CRON_SECRET não está configurado", async () => {
    delete process.env.CRON_SECRET;

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(503);
    expect(body).toEqual({ error: "CRON_SECRET não configurado" });
    expect(mocks.processNextAiJob).not.toHaveBeenCalled();
  });

  it("devolve 401 com segredo errado", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ authorized: false })),
    );

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Não autorizado" });
    expect(mocks.processNextAiJob).not.toHaveBeenCalled();
  });

  it("devolve 500 quando o processamento falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.processNextAiJob.mockRejectedValue(new Error("worker quebrou"));

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Falha ao processar a fila", processed: 0 });
  });

  it("aceita GET para o Vercel Cron", async () => {
    const { status, body } = await readJson(await GET(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual({ processed: 0 });
  });
});
