import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/ai/jobs/[jobId]/route";
import { UnauthorizedError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getAiJobForTenant: vi.fn(),
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

vi.mock("@/lib/auth", () => {
  class UnauthorizedError extends Error {
    constructor(message = "Nao autenticado") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }

  return { UnauthorizedError, getAuthContext: mocks.getAuthContext };
});

vi.mock("@/lib/documents/ai-jobs", () => ({
  getAiJobForTenant: mocks.getAiJobForTenant,
}));

const TENANT_ID = "tenant-1";
const JOB_ID = "8a1e2c3d-4b5f-4a6b-8c7d-9e0f1a2b3c4d";

function makeRequest() {
  return new Request(`http://localhost/api/ai/jobs/${JOB_ID}`);
}

function context(jobId = JOB_ID) {
  return { params: Promise.resolve({ jobId }) };
}

async function readJson(response: {
  status: number;
  json: () => Promise<unknown>;
}) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: "user-1",
    email: "user@example.com",
    tenantId: TENANT_ID,
    role: "member",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/ai/jobs/[jobId]", () => {
  it("devolve o status e o resultado do job", async () => {
    mocks.getAiJobForTenant.mockResolvedValue({
      id: JOB_ID,
      status: "succeeded",
      import_id: "import-1",
      error_message: null,
      result: { importId: "import-2", types: ["invoice"], deduped: true },
    });

    const { status, body } = await readJson(await GET(makeRequest(), context()));

    expect(status).toBe(200);
    expect(body).toEqual({
      jobId: JOB_ID,
      status: "succeeded",
      importId: "import-2",
      types: ["invoice"],
      deduped: true,
      errorMessage: null,
    });
    expect(mocks.getAiJobForTenant).toHaveBeenCalledWith(TENANT_ID, JOB_ID);
  });

  it("usa import_id e valores vazios quando ainda não há resultado", async () => {
    mocks.getAiJobForTenant.mockResolvedValue({
      id: JOB_ID,
      status: "running",
      import_id: "import-1",
      error_message: null,
      result: null,
    });

    const { status, body } = await readJson(await GET(makeRequest(), context()));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "running",
      importId: "import-1",
      types: [],
      deduped: false,
    });
  });

  it("devolve 404 para jobId que não é UUID", async () => {
    const { status } = await readJson(
      await GET(makeRequest(), context("nao-e-uuid")),
    );

    expect(status).toBe(404);
    expect(mocks.getAiJobForTenant).not.toHaveBeenCalled();
  });

  it("devolve 404 quando o job não existe no tenant", async () => {
    mocks.getAiJobForTenant.mockResolvedValue(null);

    const { status, body } = await readJson(await GET(makeRequest(), context()));

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Job não encontrado" });
  });

  it("devolve 401 sem sessão", async () => {
    mocks.getAuthContext.mockRejectedValue(new UnauthorizedError());

    const { status, body } = await readJson(await GET(makeRequest(), context()));

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Usuário não autenticado" });
  });

  it("devolve 500 quando a consulta falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAiJobForTenant.mockRejectedValue(new Error("db offline"));

    const { status, body } = await readJson(await GET(makeRequest(), context()));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Falha ao consultar job de análise" });
  });
});
