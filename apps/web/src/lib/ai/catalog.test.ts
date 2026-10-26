import { describe, expect, it } from "vitest";

import { AI_PROVIDER_CATALOG } from "@/lib/ai/catalog";
import { DEFAULT_FIREWORKS_MODEL } from "@/lib/ai/providers/fireworks-config";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

describe("AI_PROVIDER_CATALOG", () => {
  it("lista Fireworks primeiro e OpenRouter por último", () => {
    expect(AI_PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      "fireworks",
      "openrouter",
    ]);
    expect(AI_PROVIDER_CATALOG[0]?.name).toBe("Fireworks");
    expect(AI_PROVIDER_CATALOG.at(-1)?.name).toBe("OpenRouter");
  });

  it("usa o modelo padrão do Fireworks como primeiro modelo do catálogo", () => {
    const primeiroModelo = AI_PROVIDER_CATALOG[0]?.models[0];

    expect(primeiroModelo?.id).toBe(DEFAULT_FIREWORKS_MODEL);
    expect(primeiroModelo?.label).toBe("DeepSeek Flash Latest");
    expect(primeiroModelo?.hint).toBe("Padrão do servidor · multimodal");
  });

  it("inclui o preset GLM Flash Latest no Fireworks", () => {
    const modelos = AI_PROVIDER_CATALOG[0]?.models ?? [];
    const glmFlash = modelos.find(
      (modelo) => modelo.id === "accounts/fireworks/routers/glm-flash-latest",
    );

    expect(glmFlash).toBeDefined();
    expect(glmFlash?.label).toBe("GLM Flash Latest");
    expect(glmFlash?.hint).toBe("Multimodal · thinking nativo");
  });

  it("mantém os modelos atuais do OpenRouter", () => {
    const openrouter = AI_PROVIDER_CATALOG.find(
      (provider) => provider.id === "openrouter",
    );
    const ids = openrouter?.models.map((modelo) => modelo.id) ?? [];

    expect(ids).toEqual([DEFAULT_OPENROUTER_MODEL, "meta/muse-spark-1.3"]);
    expect(openrouter?.models[0]?.label).toBe("GPT Luna Latest");
    expect(openrouter?.models[1]?.label).toBe("Muse Spark 1.3");
  });

  it("descreve a conversão de PDF conforme o provedor", () => {
    const fireworks = AI_PROVIDER_CATALOG[0];
    const openrouter = AI_PROVIDER_CATALOG.at(-1);

    expect(fireworks?.description).toMatch(/PDF .* imagens/);
    expect(openrouter?.description).toMatch(/file-parser|OCR/);
  });

  it("não repete ids de modelos no catálogo", () => {
    const ids = AI_PROVIDER_CATALOG.flatMap((provider) =>
      provider.models.map((modelo) => modelo.id),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
