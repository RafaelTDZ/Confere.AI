import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterModel,
  getOpenRouterReasoning,
  type OpenRouterReasoningContext,
} from "@/lib/ai/providers/openrouter-model";

beforeEach(() => {
  vi.stubEnv("OPENROUTER_MODEL", undefined);
  vi.stubEnv("OPENROUTER_REASONING_EFFORT", undefined);
  vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", undefined);
  vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOpenRouterModel", () => {
  it("remove espaços das pontas do modelo do env", () => {
    vi.stubEnv("OPENROUTER_MODEL", "  meta/muse-spark-1.3  ");

    expect(getOpenRouterModel()).toBe("meta/muse-spark-1.3");
  });

  it("usa o modelo padrão quando o env está ausente", () => {
    expect(getOpenRouterModel()).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it("usa o modelo padrão quando o env está vazio", () => {
    vi.stubEnv("OPENROUTER_MODEL", "");

    expect(getOpenRouterModel()).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it("usa o modelo padrão quando o env contém apenas espaços", () => {
    vi.stubEnv("OPENROUTER_MODEL", "    ");

    expect(getOpenRouterModel()).toBe(DEFAULT_OPENROUTER_MODEL);
  });
});

describe("getOpenRouterReasoning", () => {
  it("omite o reasoning do smoke porque effort none não é enviado", () => {
    expect(getOpenRouterReasoning("smoke")).toBeUndefined();
  });

  it("usa effort low com exclude no contexto document", () => {
    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: true,
    });
  });

  it("usa effort low com exclude no contexto default", () => {
    expect(getOpenRouterReasoning()).toEqual({
      effort: "low",
      exclude: true,
    });
    expect(getOpenRouterReasoning("default")).toEqual({
      effort: "low",
      exclude: true,
    });
  });

  it("usa o preset default para contexto desconhecido", () => {
    expect(
      getOpenRouterReasoning("desconhecido" as OpenRouterReasoningContext),
    ).toEqual({
      effort: "low",
      exclude: true,
    });
  });

  it.each(["xhigh", "high", "medium", "low"] as const)(
    "aplica OPENROUTER_REASONING_EFFORT=%s no contexto document",
    (effort) => {
      vi.stubEnv("OPENROUTER_REASONING_EFFORT", effort);

      expect(getOpenRouterReasoning("document")).toEqual({
        effort,
        exclude: true,
      });
    },
  );

  it.each(["xhigh", "high", "medium", "low"] as const)(
    "aplica OPENROUTER_REASONING_EFFORT=%s no contexto smoke",
    (effort) => {
      vi.stubEnv("OPENROUTER_REASONING_EFFORT", effort);

      expect(getOpenRouterReasoning("smoke")).toEqual({ effort });
    },
  );

  it("aceita effort com espaços e maiúsculas", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "  HIGH  ");

    expect(getOpenRouterReasoning("smoke")).toEqual({ effort: "high" });
  });

  it("remove o reasoning quando effort é none", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "none");

    expect(getOpenRouterReasoning("document")).toBeUndefined();
    expect(getOpenRouterReasoning("smoke")).toBeUndefined();
  });

  it("ignora effort inválido e mantém o preset", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "ultra");

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: true,
    });
    expect(getOpenRouterReasoning("smoke")).toBeUndefined();
  });

  it("aplica max tokens no contexto document copiando o exclude do preset", () => {
    vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", "2048");

    expect(getOpenRouterReasoning("document")).toEqual({
      max_tokens: 2048,
      exclude: true,
    });
  });

  it("aplica max tokens no contexto smoke sem exclude", () => {
    vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", " 2048 ");

    expect(getOpenRouterReasoning("smoke")).toEqual({ max_tokens: 2048 });
  });

  it.each([
    ["zero", "0"],
    ["negativo", "-10"],
    ["texto", "abc"],
    ["vazio", ""],
    ["apenas espaços", "   "],
  ])("ignora max tokens inválido (%s)", (_rotulo, valor) => {
    vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", valor);

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: true,
    });
  });

  it("max tokens vence o effort configurado", () => {
    vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", "1024");
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "high");

    expect(getOpenRouterReasoning("document")).toEqual({
      max_tokens: 1024,
      exclude: true,
    });
  });

  it("max tokens vence effort none", () => {
    vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", "1024");
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "none");

    expect(getOpenRouterReasoning("document")).toEqual({
      max_tokens: 1024,
      exclude: true,
    });
  });

  it("aplica exclude true ao preset", () => {
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", "true");

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: true,
    });
  });

  it("aplica exclude false ao preset", () => {
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", "false");

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: false,
    });
  });

  it.each([
    ["1", true],
    ["0", false],
    [" TRUE ", true],
    [" FALSE ", false],
  ])("normaliza OPENROUTER_REASONING_EXCLUDE=%s", (valor, esperado) => {
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", valor);

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: esperado,
    });
  });

  it("ignora exclude inválido e mantém o preset", () => {
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", "sim");

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "low",
      exclude: true,
    });
    expect(getOpenRouterReasoning("smoke")).toBeUndefined();
  });

  it("aplica exclude explícito ao preset e ao max tokens", () => {
    vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", "512");
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", "false");

    expect(getOpenRouterReasoning("document")).toEqual({
      max_tokens: 512,
      exclude: false,
    });
  });

  it("aplica exclude explícito ao effort", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "medium");
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", "false");

    expect(getOpenRouterReasoning("document")).toEqual({
      effort: "medium",
      exclude: false,
    });
  });

  it("omite reasoning do smoke mesmo com exclude definido", () => {
    vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", "true");

    expect(getOpenRouterReasoning("smoke")).toBeUndefined();
  });
});
