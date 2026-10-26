import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFireworksClient } from "@/lib/ai/providers/fireworks";

const mocks = vi.hoisted(() => ({
  createFireworks: vi.fn(),
  getFireworksApiKey: vi.fn(),
}));

vi.mock("@ai-sdk/fireworks", () => ({
  createFireworks: mocks.createFireworks,
}));

vi.mock("@/lib/ai/providers/fireworks-config", () => ({
  getFireworksApiKey: mocks.getFireworksApiKey,
}));

const clienteFalso = { chat: vi.fn() };

beforeEach(() => {
  mocks.createFireworks.mockReset();
  mocks.getFireworksApiKey.mockReset();
  mocks.createFireworks.mockReturnValue(clienteFalso);
  mocks.getFireworksApiKey.mockReturnValue("fw-exemplo");
});

afterEach(() => {
  mocks.createFireworks.mockReset();
  mocks.getFireworksApiKey.mockReset();
});

describe("createFireworksClient", () => {
  it("cria o client com a api key obtida da config", () => {
    const client = createFireworksClient();

    expect(mocks.getFireworksApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.createFireworks).toHaveBeenCalledTimes(1);
    expect(mocks.createFireworks).toHaveBeenCalledWith({
      apiKey: "fw-exemplo",
    });
    expect(client).toBe(clienteFalso);
  });

  it("propaga o retorno do client criado", () => {
    const outroCliente = { chat: vi.fn() };
    mocks.createFireworks.mockReturnValue(outroCliente);

    expect(createFireworksClient()).toBe(outroCliente);
  });

  it("propaga o erro ao obter a api key", () => {
    const erro = new Error("FIREWORKS_API_KEY não configurada");
    mocks.getFireworksApiKey.mockImplementation(() => {
      throw erro;
    });

    expect(() => createFireworksClient()).toThrow(erro);
    expect(mocks.createFireworks).not.toHaveBeenCalled();
  });
});
