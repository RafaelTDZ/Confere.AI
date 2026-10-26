import { describe, expect, it } from "vitest";

import { isModelCompatibleWithProvider } from "@/lib/ai/model-compat";

const FIREWORKS_PRESETS = [
  "accounts/fireworks/routers/deepseek-flash-latest",
  "accounts/fireworks/routers/glm-flash-latest",
];
const OPENROUTER_PRESETS = ["~openai/gpt-luna-latest", "meta/muse-spark-1.3"];

describe("isModelCompatibleWithProvider", () => {
  it("rejeita modelo vazio ou só espaços", () => {
    expect(isModelCompatibleWithProvider("fireworks", "", FIREWORKS_PRESETS)).toBe(
      false,
    );
    expect(
      isModelCompatibleWithProvider("openrouter", "   ", OPENROUTER_PRESETS),
    ).toBe(false);
  });

  it("aceita presets do catálogo de cada provedor", () => {
    expect(
      isModelCompatibleWithProvider(
        "fireworks",
        "accounts/fireworks/routers/glm-flash-latest",
        FIREWORKS_PRESETS,
      ),
    ).toBe(true);
    expect(
      isModelCompatibleWithProvider(
        "openrouter",
        "meta/muse-spark-1.3",
        OPENROUTER_PRESETS,
      ),
    ).toBe(true);
  });

  it("aceita preset com espaços nas pontas", () => {
    expect(
      isModelCompatibleWithProvider(
        "openrouter",
        "  ~openai/gpt-luna-latest  ",
        OPENROUTER_PRESETS,
      ),
    ).toBe(true);
  });

  it("aceita modelo custom do Fireworks com o prefixo do provedor", () => {
    expect(
      isModelCompatibleWithProvider(
        "fireworks",
        "accounts/fireworks/models/novo-modelo",
        FIREWORKS_PRESETS,
      ),
    ).toBe(true);
  });

  it("rejeita modelo curto no Fireworks", () => {
    expect(
      isModelCompatibleWithProvider(
        "fireworks",
        "deepseek-flash-latest",
        FIREWORKS_PRESETS,
      ),
    ).toBe(false);
  });

  it("rejeita modelo do catálogo OpenRouter no Fireworks", () => {
    expect(
      isModelCompatibleWithProvider(
        "fireworks",
        "meta/muse-spark-1.3",
        FIREWORKS_PRESETS,
      ),
    ).toBe(false);
  });

  it("aceita slugs do OpenRouter com ~ ou /", () => {
    expect(
      isModelCompatibleWithProvider(
        "openrouter",
        "~anthropic/claude-sonnet-4",
        OPENROUTER_PRESETS,
      ),
    ).toBe(true);
    expect(
      isModelCompatibleWithProvider(
        "openrouter",
        "google/gemini-3-pro",
        OPENROUTER_PRESETS,
      ),
    ).toBe(true);
  });

  it("rejeita id sem / no OpenRouter", () => {
    expect(
      isModelCompatibleWithProvider("openrouter", "modelo-solto", OPENROUTER_PRESETS),
    ).toBe(false);
  });

  it("rejeita modelo do Fireworks no OpenRouter", () => {
    expect(
      isModelCompatibleWithProvider(
        "openrouter",
        "accounts/fireworks/routers/deepseek-flash-latest",
        OPENROUTER_PRESETS,
      ),
    ).toBe(false);
  });
});
