import { afterEach, describe, expect, it, vi } from "vitest";

import { AiConfigError } from "@/lib/ai/config";
import {
  DEFAULT_FIREWORKS_MODEL,
  FireworksConfigError,
  getFireworksApiKey,
  getFireworksModel,
} from "@/lib/ai/providers/fireworks-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFireworksApiKey", () => {
  it("lança FireworksConfigError quando a chave não está definida", () => {
    vi.stubEnv("FIREWORKS_API_KEY", undefined);

    expect(() => getFireworksApiKey()).toThrow(FireworksConfigError);
    expect(() => getFireworksApiKey()).toThrow("FIREWORKS_API_KEY");
    expect(() => getFireworksApiKey()).toThrow(
      "app.fireworks.ai/settings/api-keys",
    );
  });

  it.each([
    ["vazia", ""],
    ["apenas espaços", "   "],
  ])("lança erro quando a chave é %s", (_rotulo, valor) => {
    vi.stubEnv("FIREWORKS_API_KEY", valor);

    expect(() => getFireworksApiKey()).toThrow(FireworksConfigError);
  });

  it("é uma subclasse de AiConfigError", () => {
    vi.stubEnv("FIREWORKS_API_KEY", undefined);

    try {
      getFireworksApiKey();
    } catch (error) {
      expect(error).toBeInstanceOf(AiConfigError);
      expect(error).toBeInstanceOf(FireworksConfigError);
      expect((error as Error).name).toBe("FireworksConfigError");
    }
  });

  it("remove espaços das pontas da chave", () => {
    vi.stubEnv("FIREWORKS_API_KEY", "  fw-exemplo  ");

    expect(getFireworksApiKey()).toBe("fw-exemplo");
  });
});

describe("getFireworksModel", () => {
  it("usa o modelo padrão sem env", () => {
    vi.stubEnv("FIREWORKS_MODEL", undefined);

    expect(getFireworksModel()).toBe(DEFAULT_FIREWORKS_MODEL);
    expect(DEFAULT_FIREWORKS_MODEL).toBe(
      "accounts/fireworks/routers/deepseek-flash-latest",
    );
  });

  it("usa FIREWORKS_MODEL e remove espaços", () => {
    vi.stubEnv("FIREWORKS_MODEL", "  accounts/fireworks/routers/glm-flash-latest  ");

    expect(getFireworksModel()).toBe(
      "accounts/fireworks/routers/glm-flash-latest",
    );
  });

  it.each([
    ["vazio", ""],
    ["apenas espaços", "    "],
  ])("usa o padrão quando FIREWORKS_MODEL é %s", (_rotulo, valor) => {
    vi.stubEnv("FIREWORKS_MODEL", valor);

    expect(getFireworksModel()).toBe(DEFAULT_FIREWORKS_MODEL);
  });
});
