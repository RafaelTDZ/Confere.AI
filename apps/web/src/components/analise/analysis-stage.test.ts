import { describe, expect, it } from "vitest";
import { analysisStageLabel } from "@/components/analise/analysis-stage";

describe("analysisStageLabel", () => {
  it("mostra a fila enquanto o job não começou", () => {
    expect(analysisStageLabel("queued", 0)).toBe("Na fila...");
    expect(analysisStageLabel("queued", 60_000)).toBe("Na fila...");
  });

  it("avança os estágios conforme o tempo de execução", () => {
    expect(analysisStageLabel("running", 0)).toBe("Lendo o documento...");
    expect(analysisStageLabel("running", 7_999)).toBe("Lendo o documento...");
    expect(analysisStageLabel("running", 8_000)).toBe(
      "Extraindo os dados com IA...",
    );
    expect(analysisStageLabel("running", 24_999)).toBe(
      "Extraindo os dados com IA...",
    );
    expect(analysisStageLabel("running", 25_000)).toBe(
      "Finalizando a análise...",
    );
  });

  it("não tem estágio quando o job terminou", () => {
    expect(analysisStageLabel("succeeded", 10_000)).toBeNull();
    expect(analysisStageLabel("failed", 10_000)).toBeNull();
  });
});
