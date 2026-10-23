import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/ai/analyze/route";
import { AiConfigError } from "@/lib/ai";
import { UnauthorizedError } from "@/lib/auth";
import { ImportNotFoundError } from "@/lib/documents";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  runAnalyzePipeline: vi.fn(),
  persistAiLog: vi.fn(),
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
    persistAiLog: mocks.persistAiLog,
    runAnalyzePipeline: mocks.runAnalyzePipeline,
  };
});

vi.mock("@/lib/ai", () => {
  class AiConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AiConfigError";
    }
  }

  return { AiConfigError };
});

const TENANT_ID = "tenant-1";
const USER_ID = "user-1";
const IMPORT_ID = "3f2b8c1a-9d4e-4f7a-8b2c-1d5e6f7a8b9c";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const PIPELINE_RESULT = {
  importId: IMPORT_ID,
  types: ["invoice"],
  documents: [{ id: "doc-1", docType: "invoice" }],
  invoice: null,
  extractionResultId: "extraction-1",
  pendingParties: [],
  model: "model-x",
  latencyMs: 42,
};

function makeRequest(options: { file?: boolean; importId?: string } = {}) {
  const form = new FormData();
  if (options.file !== false) {
    form.append(
      "file",
      new File([PDF_BYTES], "doc.pdf", { type: "application/pdf" }),
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
  json: () => Promise<unknown>;
}): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

function pipelineParams() {
  return mocks.runAnalyzePipeline.mock.calls[0]?.[0] as {
    tenantId: string;
    userId: string;
    file: File;
    startedAt: number;
    importId?: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    email: "user@example.com",
    tenantId: TENANT_ID,
    role: "member",
  });
  mocks.runAnalyzePipeline.mockResolvedValue(PIPELINE_RESULT);
  mocks.persistAiLog.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/ai/analyze", () => {
  it("retorna 401 quando getAuthContext lança UnauthorizedError", async () => {
    mocks.getAuthContext.mockRejectedValue(new UnauthorizedError());

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Usuário não autenticado" });
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("retorna 403 para perfil viewer sem chamar o pipeline", async () => {
    mocks.getAuthContext.mockResolvedValue({
      userId: USER_ID,
      email: "user@example.com",
      tenantId: TENANT_ID,
      role: "viewer",
    });

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(403);
    expect(body).toEqual({ error: "Perfil viewer não pode enviar documentos" });
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o campo file está ausente", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ file: false })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Campo file é obrigatório" });
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o importId é inválido", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ importId: "nao-e-uuid" })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Importação inválida" });
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("retorna 200 e repassa os dados da requisição sem importId", async () => {
    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual(PIPELINE_RESULT);
    expect(mocks.runAnalyzePipeline).toHaveBeenCalledTimes(1);

    const params = pipelineParams();
    expect(params.tenantId).toBe(TENANT_ID);
    expect(params.userId).toBe(USER_ID);
    expect(params.file).toBeInstanceOf(File);
    expect(params.file.name).toBe("doc.pdf");
    expect(params.file.type).toBe("application/pdf");
    expect(params.startedAt).toEqual(expect.any(Number));
    expect(params.importId).toBeUndefined();
  });

  it("retorna 200 e repassa o importId UUID ao pipeline", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ importId: IMPORT_ID })),
    );

    expect(status).toBe(200);
    expect(body).toEqual(PIPELINE_RESULT);
    expect(mocks.runAnalyzePipeline).toHaveBeenCalledWith(
      expect.objectContaining({ importId: IMPORT_ID }),
    );
  });

  it("retorna 404 quando o pipeline lança ImportNotFoundError", async () => {
    mocks.runAnalyzePipeline.mockRejectedValue(new ImportNotFoundError());

    const { status, body } = await readJson(
      await POST(makeRequest({ importId: IMPORT_ID })),
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Importação não encontrada" });
    expect(mocks.persistAiLog).not.toHaveBeenCalled();
  });

  it("retorna 503 quando o pipeline lança AiConfigError", async () => {
    mocks.runAnalyzePipeline.mockRejectedValue(
      new AiConfigError("OPENROUTER_API_KEY ausente"),
    );

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(503);
    expect(body).toEqual({ error: "OPENROUTER_API_KEY ausente" });
    expect(mocks.persistAiLog).not.toHaveBeenCalled();
  });

  it("retorna 422 com mensagem amigável quando o PDF não pode ser lido", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.runAnalyzePipeline.mockRejectedValue(
      new Error("Failed to parse PDF"),
    );

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(422);
    expect(body).toEqual({
      error:
        "Não foi possível ler o PDF. Tente reenviar, ou use PNG/JPG do documento.",
    });
    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.persistAiLog).not.toHaveBeenCalled();
  });

  it("retorna 502 e registra o log de erro quando o pipeline falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.runAnalyzePipeline.mockRejectedValue(new Error("boom"));

    const { status, body } = await readJson(
      await POST(makeRequest({ importId: IMPORT_ID })),
    );

    expect(status).toBe(502);
    expect(body).toEqual({ error: "boom" });
    expect(consoleError).toHaveBeenCalled();
    expect(mocks.persistAiLog).toHaveBeenCalledTimes(1);
    expect(mocks.persistAiLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        capability: "analyze",
        model: "unknown",
        status: "error",
        errorMessage: "boom",
      }),
    );
  });
});
