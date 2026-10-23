import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/ai/health/route";
import { AiConfigError } from "@/lib/ai";
import { UnauthorizedError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthContext: vi.fn(),
  getAiOverrides: vi.fn(),
  getAiProvider: vi.fn(),
  getAiModelId: vi.fn(),
  getDefaultLanguageModel: vi.fn(),
  generateText: vi.fn(),
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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
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

vi.mock("@/lib/settings/ai-settings", () => ({
  getAiOverrides: mocks.getAiOverrides,
}));

vi.mock("@/lib/ai", () => {
  class AiConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AiConfigError";
    }
  }

  return {
    AiConfigError,
    getAiProvider: mocks.getAiProvider,
    getAiModelId: mocks.getAiModelId,
    getDefaultLanguageModel: mocks.getDefaultLanguageModel,
  };
});

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

const AUTH_CONTEXT = {
  userId: "user-1",
  email: "user@example.com",
  tenantId: "tenant-1",
  role: "member",
};

async function readJson(response: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: AUTH_CONTEXT.userId } },
    error: null,
  });
  mocks.getAuthContext.mockResolvedValue(AUTH_CONTEXT);
  mocks.getAiOverrides.mockResolvedValue({});
  mocks.getAiProvider.mockReturnValue("openrouter");
  mocks.getAiModelId.mockReturnValue("env-model");
  mocks.getDefaultLanguageModel.mockReturnValue("language-model");
  mocks.generateText.mockResolvedValue({ text: "  ok  " });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/ai/health", () => {
  it("retorna 401 quando não há usuário autenticado", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("sem sessão"),
    });

    const { status, body } = await readJson(await GET());

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Usuário não autenticado" });
    expect(mocks.getAuthContext).not.toHaveBeenCalled();
  });

  it("retorna 401 quando getAuthContext lança UnauthorizedError", async () => {
    mocks.getAuthContext.mockRejectedValue(new UnauthorizedError());

    const { status, body } = await readJson(await GET());

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Usuário não autenticado" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("retorna 503 quando getAiProvider lança AiConfigError", async () => {
    mocks.getAiProvider.mockImplementation(() => {
      throw new AiConfigError("OPENROUTER_API_KEY ausente");
    });

    const { status, body } = await readJson(await GET());

    expect(status).toBe(503);
    expect(body).toEqual({ error: "OPENROUTER_API_KEY ausente" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("retorna 200 com a config global e o texto normalizado", async () => {
    mocks.getAiOverrides.mockResolvedValue({
      provider: "openrouter",
      model: "model-x",
    });
    mocks.getAiProvider.mockReturnValue("openrouter");
    mocks.getAiModelId.mockReturnValue("model-x");
    mocks.getDefaultLanguageModel.mockReturnValue("language-model-x");

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      provider: "openrouter",
      model: "model-x",
      source: "global",
      text: "ok",
      latencyMs: expect.any(Number),
    });
    expect(mocks.generateText).toHaveBeenCalledWith({
      model: "language-model-x",
      prompt: 'Responda apenas com a palavra "ok".',
    });
  });

  it("usa source env quando não há overrides", async () => {
    mocks.getAiOverrides.mockResolvedValue({});

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      provider: "openrouter",
      model: "env-model",
      source: "env",
      text: "ok",
    });
  });

  it("retorna 502 quando o provider lança um erro genérico", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.generateText.mockRejectedValue(new Error("provider indisponível"));

    const { status, body } = await readJson(await GET());

    expect(status).toBe(502);
    expect(body).toEqual({ error: "provider indisponível" });
    expect(consoleError).toHaveBeenCalled();
  });
});
