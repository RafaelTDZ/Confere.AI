import { afterEach, describe, expect, it, vi } from "vitest";

import { AiConfigError, getOpenRouterApiKey } from "@/lib/ai/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

function capturarErro(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("getOpenRouterApiKey", () => {
  it("lança AiConfigError quando a variável está ausente", () => {
    vi.stubEnv("OPENROUTER_API_KEY", undefined);

    const erro = capturarErro(() => getOpenRouterApiKey());

    expect(erro).toBeInstanceOf(AiConfigError);
    expect((erro as Error).message).toContain("OPENROUTER_API_KEY");
  });

  it("lança AiConfigError quando a variável está vazia", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    const erro = capturarErro(() => getOpenRouterApiKey());

    expect(erro).toBeInstanceOf(AiConfigError);
    expect((erro as Error).message).toContain("OPENROUTER_API_KEY");
  });

  it("lança AiConfigError quando a variável contém apenas espaços", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "   ");

    const erro = capturarErro(() => getOpenRouterApiKey());

    expect(erro).toBeInstanceOf(AiConfigError);
    expect((erro as Error).message).toContain("OPENROUTER_API_KEY");
  });

  it("retorna a chave sem espaços nas pontas", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "  sk-or-v1-exemplo  ");

    expect(getOpenRouterApiKey()).toBe("sk-or-v1-exemplo");
  });

  it("retorna a chave quando já está normalizada", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-exemplo");

    expect(getOpenRouterApiKey()).toBe("sk-or-v1-exemplo");
  });
});
