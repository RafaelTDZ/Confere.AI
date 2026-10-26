import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiOverrides } from "@/lib/ai/provider";
import {
  getAiModelId,
  getAiProvider,
  getDefaultLanguageModel,
  normalizeOverrides,
} from "@/lib/ai/provider";
import { DEFAULT_FIREWORKS_MODEL } from "@/lib/ai/providers/fireworks-config";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

const mocks = vi.hoisted(() => ({
  createFireworksClient: vi.fn(),
  createOpenRouterClient: vi.fn(),
}));

vi.mock("@/lib/ai/providers/fireworks", () => ({
  createFireworksClient: mocks.createFireworksClient,
}));

vi.mock("@/lib/ai/providers/openrouter", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

const fireworks = vi.fn((modelId: string) => ({ provider: "fireworks", modelId }));
const openrouter = vi.fn((modelId: string, options?: unknown) => ({
  provider: "openrouter",
  modelId,
  options,
}));

beforeEach(() => {
  mocks.createFireworksClient.mockReset();
  mocks.createOpenRouterClient.mockReset();
  fireworks.mockClear();
  openrouter.mockClear();
  mocks.createFireworksClient.mockReturnValue(fireworks);
  mocks.createOpenRouterClient.mockReturnValue(openrouter);
  vi.stubEnv("AI_PROVIDER", undefined);
  vi.stubEnv("FIREWORKS_MODEL", undefined);
  vi.stubEnv("OPENROUTER_MODEL", undefined);
  vi.stubEnv("OPENROUTER_REASONING_EFFORT", undefined);
  vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", undefined);
  vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeOverrides", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", ["openrouter"]],
    ["string", "openrouter"],
    ["número", 42],
    ["booleano", true],
  ])("retorna vazio para valor inválido (%s)", (_rotulo, valor) => {
    expect(normalizeOverrides(valor)).toEqual({});
  });

  it("descarta a linha inteira quando o provider é legado (opencode)", () => {
    expect(
      normalizeOverrides({ provider: "opencode", model: "modelo-antigo" }),
    ).toEqual({});
  });

  it("descarta a linha inteira quando o provider é inválido", () => {
    expect(
      normalizeOverrides({ provider: "firework", model: "modelo-antigo" }),
    ).toEqual({});
  });

  it("mantém o provider fireworks", () => {
    expect(normalizeOverrides({ provider: "fireworks" })).toEqual({
      provider: "fireworks",
    });
  });

  it("mantém o provider openrouter", () => {
    expect(normalizeOverrides({ provider: "openrouter" })).toEqual({
      provider: "openrouter",
    });
  });

  it("mantém o modelo junto do provider fireworks", () => {
    expect(
      normalizeOverrides({
        provider: "fireworks",
        model: DEFAULT_FIREWORKS_MODEL,
      }),
    ).toEqual({
      provider: "fireworks",
      model: DEFAULT_FIREWORKS_MODEL,
    });
  });

  it("mantém o modelo junto do provider openrouter", () => {
    expect(
      normalizeOverrides({
        provider: "openrouter",
        model: "meta/muse-spark-1.3",
      }),
    ).toEqual({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
    });
  });

  it("remove espaços das pontas do modelo", () => {
    expect(normalizeOverrides({ model: "  ~openai/gpt-luna-latest  " })).toEqual(
      { model: "~openai/gpt-luna-latest" },
    );
  });

  it.each([
    ["vazio", ""],
    ["apenas espaços", "   "],
    ["acima de 200 caracteres", "a".repeat(201)],
    ["não string", 123],
    ["nulo", null],
  ])("ignora modelo inválido (%s)", (_rotulo, model) => {
    expect(normalizeOverrides({ model })).toEqual({});
  });

  it("aceita modelo com exatamente 200 caracteres", () => {
    const model = "a".repeat(200);

    expect(normalizeOverrides({ model })).toEqual({ model });
  });

  it("ignora campos extras", () => {
    const resultado = normalizeOverrides({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
      temperature: 0.5,
      foo: "bar",
    });

    expect(resultado).toEqual({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
    });
    expect(resultado).not.toHaveProperty("temperature");
    expect(resultado).not.toHaveProperty("foo");
  });
});

describe("getAiProvider", () => {
  it("usa fireworks por padrão", () => {
    expect(getAiProvider()).toBe("fireworks");
    expect(getAiProvider({})).toBe("fireworks");
  });

  it("usa AI_PROVIDER quando não há override", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");

    expect(getAiProvider()).toBe("openrouter");
  });

  it("normaliza AI_PROVIDER (case-insensitive e com espaços)", () => {
    vi.stubEnv("AI_PROVIDER", "  OpenRouter  ");

    expect(getAiProvider()).toBe("openrouter");
  });

  it("ignora AI_PROVIDER inválido e usa fireworks", () => {
    vi.stubEnv("AI_PROVIDER", "opencode");

    expect(getAiProvider()).toBe("fireworks");
  });

  it("dá prioridade ao override sobre AI_PROVIDER", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");

    expect(getAiProvider({ provider: "fireworks" })).toBe("fireworks");
  });

  it("ignora provider inválido recebido fora do normalize", () => {
    expect(
      getAiProvider({ provider: "opencode" } as unknown as AiOverrides),
    ).toBe("fireworks");
  });
});

describe("getAiModelId", () => {
  it("usa o override quando presente", () => {
    vi.stubEnv("FIREWORKS_MODEL", "modelo-do-env");

    expect(
      getAiModelId({ provider: "fireworks", model: "  glm-flash-latest  " }),
    ).toBe("glm-flash-latest");
  });

  it("usa FIREWORKS_MODEL no provider padrão", () => {
    vi.stubEnv("FIREWORKS_MODEL", "  modelo-fireworks  ");

    expect(getAiModelId()).toBe("modelo-fireworks");
    expect(getAiModelId({})).toBe("modelo-fireworks");
  });

  it("usa OPENROUTER_MODEL quando o provider é openrouter", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_MODEL", "  modelo-openrouter  ");

    expect(getAiModelId()).toBe("modelo-openrouter");
  });

  it("usa o modelo padrão do Fireworks sem override nem env", () => {
    expect(getAiModelId()).toBe(DEFAULT_FIREWORKS_MODEL);
  });

  it("usa o modelo padrão do OpenRouter quando o provider é openrouter", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");

    expect(getAiModelId()).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it("ignora override de modelo vazio e usa o env", () => {
    vi.stubEnv("FIREWORKS_MODEL", "modelo-do-env");

    expect(getAiModelId({ model: "   " })).toBe("modelo-do-env");
  });
});

describe("getDefaultLanguageModel", () => {
  it("chama o client Fireworks com o modelo padrão", () => {
    const resultado = getDefaultLanguageModel();

    expect(mocks.createFireworksClient).toHaveBeenCalledTimes(1);
    expect(mocks.createOpenRouterClient).not.toHaveBeenCalled();
    expect(fireworks).toHaveBeenCalledWith(DEFAULT_FIREWORKS_MODEL);
    expect(resultado).toEqual({
      provider: "fireworks",
      modelId: DEFAULT_FIREWORKS_MODEL,
    });
  });

  it("chama o client Fireworks com o modelo do override", () => {
    getDefaultLanguageModel({
      provider: "fireworks",
      model: "accounts/fireworks/routers/glm-flash-latest",
    });

    expect(fireworks).toHaveBeenCalledWith(
      "accounts/fireworks/routers/glm-flash-latest",
    );
  });

  it("usa o client OpenRouter (sem reasoning) quando o provider é openrouter", () => {
    const resultado = getDefaultLanguageModel({ provider: "openrouter" });

    expect(mocks.createFireworksClient).not.toHaveBeenCalled();
    expect(mocks.createOpenRouterClient).toHaveBeenCalledTimes(1);
    expect(openrouter).toHaveBeenCalledWith(DEFAULT_OPENROUTER_MODEL, undefined);
    expect(resultado).toBe(openrouter.mock.results[0]?.value);
  });

  it("encaminha o reasoning do contexto smoke quando configurado", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "high");

    getDefaultLanguageModel();

    expect(openrouter).toHaveBeenCalledWith(DEFAULT_OPENROUTER_MODEL, {
      reasoning: { effort: "high" },
    });
  });

  it("propaga erro de configuração do Fireworks", () => {
    const erro = new Error("FIREWORKS_API_KEY não configurada");
    mocks.createFireworksClient.mockImplementation(() => {
      throw erro;
    });

    expect(() => getDefaultLanguageModel()).toThrow(erro);
    expect(openrouter).not.toHaveBeenCalled();
  });
});
