import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenRouterClient } from "@/lib/ai/providers/openrouter";

const mocks = vi.hoisted(() => ({
  createOpenRouter: vi.fn(),
  getOpenRouterApiKey: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: mocks.createOpenRouter,
}));

vi.mock("@/lib/ai/config", () => {
  class AiConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AiConfigError";
    }
  }

  return {
    AiConfigError,
    getOpenRouterApiKey: mocks.getOpenRouterApiKey,
  };
});

const clienteFalso = { chat: vi.fn() };

beforeEach(() => {
  mocks.createOpenRouter.mockReset();
  mocks.getOpenRouterApiKey.mockReset();
  mocks.createOpenRouter.mockReturnValue(clienteFalso);
  mocks.getOpenRouterApiKey.mockReturnValue("sk-or-v1-exemplo");
});

afterEach(() => {
  mocks.createOpenRouter.mockReset();
  mocks.getOpenRouterApiKey.mockReset();
});

describe("createOpenRouterClient", () => {
  it("cria o client com a api key obtida da config", () => {
    const client = createOpenRouterClient();

    expect(mocks.getOpenRouterApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.createOpenRouter).toHaveBeenCalledTimes(1);
    expect(mocks.createOpenRouter).toHaveBeenCalledWith({
      apiKey: "sk-or-v1-exemplo",
    });
    expect(client).toBe(clienteFalso);
  });

  it("propaga o retorno do client criado", () => {
    const outroCliente = { chat: vi.fn() };
    mocks.createOpenRouter.mockReturnValue(outroCliente);

    expect(createOpenRouterClient()).toBe(outroCliente);
  });

  it("propaga o erro ao obter a api key", () => {
    const erro = new Error("OPENROUTER_API_KEY não configurada");
    mocks.getOpenRouterApiKey.mockImplementation(() => {
      throw erro;
    });

    expect(() => createOpenRouterClient()).toThrow(erro);
    expect(mocks.createOpenRouter).not.toHaveBeenCalled();
  });
});
