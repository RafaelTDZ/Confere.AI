import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiOverrides } from "@/lib/ai/provider";
import {
  getAiModelId,
  getAiProvider,
  getDefaultLanguageModel,
  normalizeOverrides,
} from "@/lib/ai/provider";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

const mocks = vi.hoisted(() => ({
  createOpenRouterClient: vi.fn(),
}));

vi.mock("@/lib/ai/providers/openrouter", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

const openrouter = vi.fn((modelId: string, options?: unknown) => ({
  modelId,
  options,
}));

beforeEach(() => {
  mocks.createOpenRouterClient.mockReset();
  openrouter.mockClear();
  mocks.createOpenRouterClient.mockReturnValue(openrouter);
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

  it("descarta a linha inteira quando o provider é legado (fireworks)", () => {
    expect(
      normalizeOverrides({ provider: "fireworks", model: "modelo-antigo" }),
    ).toEqual({});
  });

  it("descarta a linha inteira quando o provider é legado (opencode)", () => {
    expect(
      normalizeOverrides({ provider: "opencode", model: "modelo-antigo" }),
    ).toEqual({});
  });

  it("mantém o provider openrouter", () => {
    expect(normalizeOverrides({ provider: "openrouter" })).toEqual({
      provider: "openrouter",
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
  it("retorna sempre openrouter sem overrides", () => {
    expect(getAiProvider()).toBe("openrouter");
  });

  it("retorna sempre openrouter mesmo com override", () => {
    expect(getAiProvider({ model: "meta/muse-spark-1.3" })).toBe("openrouter");
    expect(
      getAiProvider({ provider: "fireworks" } as unknown as AiOverrides),
    ).toBe("openrouter");
  });
});

describe("getAiModelId", () => {
  it("usa o override do tenant quando presente", () => {
    vi.stubEnv("OPENROUTER_MODEL", "modelo-do-env");

    expect(getAiModelId({ model: "  meta/muse-spark-1.3  " })).toBe(
      "meta/muse-spark-1.3",
    );
  });

  it("usa OPENROUTER_MODEL quando não há override", () => {
    vi.stubEnv("OPENROUTER_MODEL", "  modelo-do-env  ");

    expect(getAiModelId()).toBe("modelo-do-env");
    expect(getAiModelId({})).toBe("modelo-do-env");
  });

  it("ignora override de modelo vazio e usa o env", () => {
    vi.stubEnv("OPENROUTER_MODEL", "modelo-do-env");

    expect(getAiModelId({ model: "   " })).toBe("modelo-do-env");
  });

  it("usa o modelo padrão quando não há override nem env", () => {
    expect(getAiModelId()).toBe(DEFAULT_OPENROUTER_MODEL);
  });
});

describe("getDefaultLanguageModel", () => {
  it("chama o client com o modelo padrão e sem reasoning quando effort é none", () => {
    const resultado = getDefaultLanguageModel();

    expect(mocks.createOpenRouterClient).toHaveBeenCalledTimes(1);
    expect(openrouter).toHaveBeenCalledWith(DEFAULT_OPENROUTER_MODEL, undefined);
    expect(resultado).toBe(openrouter.mock.results[0]?.value);
    expect(resultado).toEqual({
      modelId: DEFAULT_OPENROUTER_MODEL,
      options: undefined,
    });
  });

  it("chama o client com o modelo do override", () => {
    getDefaultLanguageModel({ model: "meta/muse-spark-1.3" });

    expect(openrouter).toHaveBeenCalledWith(
      "meta/muse-spark-1.3",
      undefined,
    );
  });

  it("chama o client com o modelo do env", () => {
    vi.stubEnv("OPENROUTER_MODEL", "modelo-do-env");

    getDefaultLanguageModel();

    expect(openrouter).toHaveBeenCalledWith("modelo-do-env", undefined);
  });

  it("encaminha o reasoning do contexto smoke quando configurado", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "high");

    getDefaultLanguageModel();

    expect(openrouter).toHaveBeenCalledWith(DEFAULT_OPENROUTER_MODEL, {
      reasoning: { effort: "high" },
    });
  });
});
