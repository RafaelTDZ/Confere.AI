import { describe, expect, it } from "vitest";

import { AI_PROVIDER_CATALOG } from "@/lib/ai/catalog";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

describe("AI_PROVIDER_CATALOG", () => {
  it("tem exatamente um provider openrouter", () => {
    expect(AI_PROVIDER_CATALOG).toHaveLength(1);
    expect(AI_PROVIDER_CATALOG[0]?.id).toBe("openrouter");
    expect(AI_PROVIDER_CATALOG[0]?.name).toBe("OpenRouter");
  });

  it("usa o modelo padrão como primeiro modelo do catálogo", () => {
    const primeiroModelo = AI_PROVIDER_CATALOG[0]?.models[0];

    expect(primeiroModelo?.id).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(primeiroModelo?.label).toBe("GPT Luna Latest");
    expect(primeiroModelo?.hint).toBe("Padrão do servidor");
  });

  it("inclui o preset meta/muse-spark-1.3", () => {
    const modelos = AI_PROVIDER_CATALOG[0]?.models ?? [];
    const museSpark = modelos.find(
      (modelo) => modelo.id === "meta/muse-spark-1.3",
    );

    expect(museSpark).toBeDefined();
    expect(museSpark?.label).toBe("Muse Spark 1.3");
  });

  it("não repete ids de modelos no catálogo", () => {
    const ids = (AI_PROVIDER_CATALOG[0]?.models ?? []).map(
      (modelo) => modelo.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
