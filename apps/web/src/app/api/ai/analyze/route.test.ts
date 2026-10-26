import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/ai/analyze/route";
import { UnauthorizedError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  createAiJob: vi.fn(),
  processAiJobById: vi.fn(),
  persistAiLog: vi.fn(),
  getMonthlyTokenUsage: vi.fn(),
  consumeRateLimit: vi.fn(),
  getAnalyzeRateLimit: vi.fn(),
  getAnalyzeRateWindowSeconds: vi.fn(),
  getMonthlyTokenQuota: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) => ({
      status: init?.status ?? 200,
      body,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
  after: (callback: () => unknown) => {
    mocks.afterCallbacks.push(callback);
  },
}));

vi.mock("@/lib/auth", () => {
  class UnauthorizedError extends Error {
    constructor(message = "Nao autenticado") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }

  return {
    UnauthorizedError,
    getAuthContext: mocks.getAuthContext,
  };
});

vi.mock("@/lib/documents", () => {
  class ImportNotFoundError extends Error {
    constructor() {
      super("Importação não encontrada");
      this.name = "ImportNotFoundError";
    }
  }

  class ImportValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ImportValidationError";
    }
  }

  return {
    ImportNotFoundError,
    ImportValidationError,
    getMonthlyTokenUsage: mocks.getMonthlyTokenUsage,
    persistAiLog: mocks.persistAiLog,
  };
});

vi.mock("@/lib/documents/ai-jobs", () => ({
  createAiJob: mocks.createAiJob,
}));

vi.mock("@/lib/documents/ai-worker", () => ({
  processAiJobById: mocks.processAiJobById,
}));

vi.mock("@/lib/ai", () => {
  class AiConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AiConfigError";
    }
  }

  return { AiConfigError };
});

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  getAnalyzeRateLimit: mocks.getAnalyzeRateLimit,
  getAnalyzeRateWindowSeconds: mocks.getAnalyzeRateWindowSeconds,
  getMonthlyTokenQuota: mocks.getMonthlyTokenQuota,
}));

const TENANT_ID = "tenant-1";
const USER_ID = "user-1";
const IMPORT_ID = "3f2b8c1a-9d4e-4f7a-8b2c-1d5e6f7a8b9c";
const JOB_ID = "8a1e2c3d-4b5f-4a6b-8c7d-9e0f1a2b3c4d";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function makeRequest(
  options: {
    file?: boolean;
    importId?: string;
    type?: string;
    filename?: string;
  } = {},
) {
  const form = new FormData();
  if (options.file !== false) {
    form.append(
      "file",
      new File([PDF_BYTES], options.filename ?? "doc.pdf", {
        type: options.type ?? "application/pdf",
      }),
    );
  }
  if (options.importId !== undefined) {
    form.append("importId", options.importId);
  }
  return new Request("http://localhost/api/ai/analyze", {
    method: "POST",
    body: form,
  });
}

async function readJson(response: {
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
}) {
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    import_id: null,
    user_id: USER_ID,
    status: "queued",
    storage_path: `${TENANT_ID}/_jobs/${JOB_ID}/doc.pdf`,
    file_name: "doc.pdf",
    media_type: "application/pdf",
    size_bytes: PDF_BYTES.byteLength,
    sha256: "digest",
    attempts: 0,
    error_message: null,
    result: null,
    created_at: "2026-10-26T12:00:00.000Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    email: "user@example.com",
    tenantId: TENANT_ID,
    role: "operator",
  });
  mocks.createAiJob.mockResolvedValue(jobRow());
  mocks.processAiJobById.mockResolvedValue(undefined);
  mocks.persistAiLog.mockResolvedValue(undefined);
  mocks.consumeRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 29,
    resetAt: "2026-10-23T13:00:00.000Z",
    retryAfterSeconds: 0,
  });
  mocks.getAnalyzeRateLimit.mockReturnValue(30);
  mocks.getAnalyzeRateWindowSeconds.mockReturnValue(3600);
  mocks.getMonthlyTokenUsage.mockResolvedValue(0);
  mocks.getMonthlyTokenQuota.mockReturnValue(10_000_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/ai/analyze", () => {
  it("retorna 401 quando getAuthContext lança UnauthorizedError", async () => {
    mocks.getAuthContext.mockRejectedValue(new UnauthorizedError());

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Usuário não autenticado" });
    expect(mocks.createAiJob).not.toHaveBeenCalled();
  });

  it("retorna 403 para perfil viewer sem criar job", async () => {
    mocks.getAuthContext.mockResolvedValue({
      userId: USER_ID,
      email: "user@example.com",
      tenantId: TENANT_ID,
      role: "viewer",
    });

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(403);
    expect(body).toEqual({ error: "Perfil viewer não pode enviar documentos" });
    expect(mocks.createAiJob).not.toHaveBeenCalled();
  });

  it("retorna 429 com Retry-After quando o rate limit bloqueia", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: "2026-10-23T13:00:00.000Z",
      retryAfterSeconds: 120,
    });

    const response = await POST(makeRequest());
    const { status, body, headers } = await readJson(response);

    expect(status).toBe(429);
    expect(body).toEqual({
      error: "Muitas análises em pouco tempo. Tente novamente mais tarde.",
    });
    expect(headers.get("Retry-After")).toBe("120");
    expect(mocks.createAiJob).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      bucket: `analyze:tenant:${TENANT_ID}`,
      limit: 30,
      windowSeconds: 3600,
    });
  });

  it("segue o fluxo quando o rate limiter lança erro (fail-open)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("banco indisponível");
    mocks.consumeRateLimit.mockRejectedValue(failure);

    const { status } = await readJson(await POST(makeRequest()));

    expect(status).toBe(202);
    expect(consoleError).toHaveBeenCalledWith(
      "[api/ai/analyze] rate limit indisponível",
      failure,
    );
    expect(mocks.createAiJob).toHaveBeenCalledTimes(1);
  });

  it("retorna 429 com Retry-After quando a quota mensal é atingida", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    mocks.getMonthlyTokenUsage.mockResolvedValue(10_000_000);
    mocks.getMonthlyTokenQuota.mockReturnValue(10_000_000);

    const response = await POST(makeRequest());
    const { status, body, headers } = await readJson(response);

    expect(status).toBe(429);
    expect(body).toEqual({
      error: "Quota mensal de IA atingida. Tente novamente no próximo mês.",
    });
    expect(headers.get("Retry-After")).toBe("734400");
    expect(mocks.getMonthlyTokenUsage).toHaveBeenCalledWith(TENANT_ID);
    expect(mocks.createAiJob).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it("segue o fluxo quando o cálculo de quota lança erro (fail-open)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("ai_logs indisponível");
    mocks.getMonthlyTokenUsage.mockRejectedValue(failure);

    const { status } = await readJson(await POST(makeRequest()));

    expect(status).toBe(202);
    expect(consoleError).toHaveBeenCalledWith(
      "[api/ai/analyze] quota indisponível",
      failure,
    );
    expect(mocks.createAiJob).toHaveBeenCalledTimes(1);
  });

  it("retorna 400 quando o campo file está ausente", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ file: false })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Campo file é obrigatório" });
    expect(mocks.createAiJob).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o importId é inválido", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ importId: "nao-e-uuid" })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Importação inválida" });
    expect(mocks.createAiJob).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o tipo do arquivo não é suportado", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ type: "text/plain", filename: "doc.txt" })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({
      error: "Tipo de arquivo não suportado. Envie PDF, PNG, JPG ou WEBP.",
    });
    expect(mocks.createAiJob).not.toHaveBeenCalled();
  });

  it("cria o job e responde 202 sem esperar o pipeline", async () => {
    const response = await POST(makeRequest());
    const { status, body } = await readJson(response);

    expect(status).toBe(202);
    expect(body).toEqual({
      jobId: JOB_ID,
      importId: null,
      status: "queued",
    });

    const params = mocks.createAiJob.mock.calls[0]?.[0] as {
      tenantId: string;
      userId: string;
      importId?: string;
      file: {
        bytes: Uint8Array;
        filename: string;
        mediaType: string;
        digest: string;
      };
    };
    expect(params.tenantId).toBe(TENANT_ID);
    expect(params.userId).toBe(USER_ID);
    expect(params.importId).toBeUndefined();
    expect(params.file.bytes).toEqual(PDF_BYTES);
    expect(params.file.filename).toBe("doc.pdf");
    expect(params.file.mediaType).toBe("application/pdf");
    expect(params.file.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.processAiJobById).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);
  });

  it("processa o job no callback do after()", async () => {
    await POST(makeRequest());

    const callback = mocks.afterCallbacks[0];
    expect(callback).toBeDefined();
    await callback?.();

    expect(mocks.processAiJobById).toHaveBeenCalledWith(JOB_ID);
  });

  it("não deixa o callback do after() rejeitar quando o worker falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.processAiJobById.mockRejectedValue(new Error("worker quebrou"));

    await POST(makeRequest());

    const callback = mocks.afterCallbacks[0];
    await expect(callback?.()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "[api/ai/analyze] worker falhou",
      expect.any(Error),
    );
  });

  it("repassa o importId UUID ao job", async () => {
    mocks.createAiJob.mockResolvedValue(jobRow({ import_id: IMPORT_ID }));

    const { status, body } = await readJson(
      await POST(makeRequest({ importId: IMPORT_ID })),
    );

    expect(status).toBe(202);
    expect(body).toMatchObject({ importId: IMPORT_ID });
    expect(mocks.createAiJob).toHaveBeenCalledWith(
      expect.objectContaining({ importId: IMPORT_ID }),
    );
  });

  it("retorna 502 e registra o log de erro quando a criação do job falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.createAiJob.mockRejectedValue(new Error("storage offline"));

    const { status, body } = await readJson(
      await POST(makeRequest({ importId: IMPORT_ID })),
    );

    expect(status).toBe(502);
    expect(body).toEqual({ error: "storage offline" });
    expect(consoleError).toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.persistAiLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        capability: "analyze",
        model: "unknown",
        status: "error",
        errorMessage: "storage offline",
        importId: IMPORT_ID,
      }),
    );
  });

  it("registra o log de erro sem vínculo quando não há importId", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createAiJob.mockRejectedValue(new Error("boom"));

    const { status } = await readJson(await POST(makeRequest()));

    expect(status).toBe(502);

    const logParams = mocks.persistAiLog.mock.calls[0]?.[0] as
      | { importId?: string }
      | undefined;
    expect(logParams).toBeDefined();
    expect(logParams?.importId).toBeUndefined();
  });
});
