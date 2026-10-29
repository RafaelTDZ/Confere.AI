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
  consumeRateLimit: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) => ({
      status: init?.status ?? 200,
      body,
      headers: init?.headers ?? {},
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
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
  role: "operator",
};

async function readJson(response: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

const RATE_LIMIT_OK = {
  allowed: true,
  remaining: 19,
  resetAt: "2026-10-29T13:00:00.000Z",
  retryAfterSeconds: 600,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: AUTH_CONTEXT.userId } },
    error: null,
  });
  mocks.getAuthContext.mockResolvedValue(AUTH_CONTEXT);
  mocks.getAiOverrides.mockResolvedValue({});
  mocks.getAiProvider.mockReturnValue("fireworks");
  mocks.getAiModelId.mockReturnValue("env-model");
  mocks.getDefaultLanguageModel.mockReturnValue("language-model");
  mocks.generateText.mockResolvedValue({ text: "  ok  " });
  mocks.consumeRateLimit.mockResolvedValue(RATE_LIMIT_OK);
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

  it("retorna 503 quando getDefaultLanguageModel lança AiConfigError", async () => {
    mocks.getDefaultLanguageModel.mockImplementation(() => {
      throw new AiConfigError("FIREWORKS_API_KEY ausente");
    });

    const { status, body } = await readJson(await GET());

    expect(status).toBe(503);
    expect(body).toEqual({ error: "FIREWORKS_API_KEY ausente" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("retorna 200 com Fireworks definido pela config global", async () => {
    mocks.getAiOverrides.mockResolvedValue({
      provider: "fireworks",
      model: "accounts/fireworks/routers/deepseek-flash-latest",
    });
    mocks.getAiProvider.mockReturnValue("fireworks");
    mocks.getAiModelId.mockReturnValue(
      "accounts/fireworks/routers/deepseek-flash-latest",
    );
    mocks.getDefaultLanguageModel.mockReturnValue("language-model-x");

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      provider: "fireworks",
      model: "accounts/fireworks/routers/deepseek-flash-latest",
      source: "global",
      text: "ok",
      latencyMs: expect.any(Number),
    });
    expect(mocks.generateText).toHaveBeenCalledWith({
      model: "language-model-x",
      prompt: 'Responda apenas com a palavra "ok".',
    });
  });

  it("retorna 200 com OpenRouter quando selecionado", async () => {
    mocks.getAiOverrides.mockResolvedValue({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
    });
    mocks.getAiProvider.mockReturnValue("openrouter");
    mocks.getAiModelId.mockReturnValue("meta/muse-spark-1.3");

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
      source: "global",
      text: "ok",
    });
  });

  it("usa source env quando não há overrides", async () => {
    mocks.getAiOverrides.mockResolvedValue({});

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      provider: "fireworks",
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

  it("consome o rate limit por tenant dentro do limite", async () => {
    const { status } = await readJson(await GET());

    expect(status).toBe(200);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      bucket: `ai:health:${AUTH_CONTEXT.tenantId}`,
      limit: 20,
      windowSeconds: 3600,
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("retorna 429 com Retry-After quando o limite estoura", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: "2026-10-29T13:00:00.000Z",
      retryAfterSeconds: 1234,
    });

    const response = await GET();

    expect(response.status).toBe(429);
    expect(response.headers).toEqual({ "Retry-After": "1234" });
    expect(await response.json()).toEqual({
      error: "Muitos testes de IA em pouco tempo. Tente novamente mais tarde.",
      retryAfterSeconds: 1234,
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("não consome o rate limit sem sessão", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("sem sessão"),
    });

    const { status } = await readJson(await GET());

    expect(status).toBe(401);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("não consome o rate limit quando falta a chave do provider (503)", async () => {
    mocks.getDefaultLanguageModel.mockImplementation(() => {
      throw new AiConfigError("FIREWORKS_API_KEY ausente");
    });

    const { status } = await readJson(await GET());

    expect(status).toBe(503);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("segue o fluxo quando o rate limiter está indisponível (fail-open)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.consumeRateLimit.mockRejectedValue(new Error("RPC fora"));

    const { status } = await readJson(await GET());

    expect(status).toBe(200);
    expect(consoleError).toHaveBeenCalled();
  });
});
