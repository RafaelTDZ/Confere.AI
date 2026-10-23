import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
} from "@/lib/ai/tasks/document-model";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

const mocks = vi.hoisted(() => ({
  createOpenRouterClient: vi.fn(),
}));

vi.mock("@/lib/ai/providers/openrouter", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

type ModeloCriado = {
  modelId: string;
  options?: unknown;
};

const criarModelo = vi.fn((modelId: string, options?: unknown) => ({
  modelId,
  options,
}));

function gerarModelo(options?: {
  isPdf?: boolean;
  pdfEngine?: "native" | "mistral-ocr";
  overrides?: { provider?: "openrouter"; model?: string };
}): ModeloCriado {
  return getDocumentLanguageModel(options) as unknown as ModeloCriado;
}

beforeEach(() => {
  criarModelo.mockClear();
  mocks.createOpenRouterClient.mockReset();
  mocks.createOpenRouterClient.mockReturnValue(criarModelo);
  vi.stubEnv("OPENROUTER_MODEL", undefined);
  vi.stubEnv("OPENROUTER_REASONING_EFFORT", undefined);
  vi.stubEnv("OPENROUTER_REASONING_MAX_TOKENS", undefined);
  vi.stubEnv("OPENROUTER_REASONING_EXCLUDE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDocumentLanguageModel", () => {
  it("usa engine native no PDF com file-parser e response-healing", () => {
    const modelo = gerarModelo({ isPdf: true });

    expect(mocks.createOpenRouterClient).toHaveBeenCalledTimes(1);
    expect(mocks.createOpenRouterClient).toHaveBeenCalledWith();
    expect(modelo.modelId).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(modelo.options).toEqual({
      reasoning: { effort: "low", exclude: true },
      plugins: [
        { id: "file-parser", pdf: { engine: "native" } },
        { id: "response-healing" },
      ],
    });
  });

  it("usa engine mistral-ocr no PDF quando solicitado", () => {
    const modelo = gerarModelo({ isPdf: true, pdfEngine: "mistral-ocr" });

    expect(modelo.options).toEqual({
      reasoning: { effort: "low", exclude: true },
      plugins: [
        { id: "file-parser", pdf: { engine: "mistral-ocr" } },
        { id: "response-healing" },
      ],
    });
  });

  it("não adiciona file-parser para arquivo que não é PDF", () => {
    const modelo = gerarModelo({ isPdf: false });

    expect(modelo.options).toEqual({
      reasoning: { effort: "low", exclude: true },
      plugins: [{ id: "response-healing" }],
    });
  });

  it("assume não-PDF quando as opções são omitidas", () => {
    const modelo = gerarModelo();

    expect(modelo.options).toEqual({
      reasoning: { effort: "low", exclude: true },
      plugins: [{ id: "response-healing" }],
    });
  });

  it("inclui o reasoning configurado por env", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "high");

    const modelo = gerarModelo({ isPdf: true });

    expect(modelo.options).toMatchObject({
      reasoning: { effort: "high", exclude: true },
    });
  });

  it("omite o reasoning quando o env desativa o esforço (none)", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "none");

    const modelo = gerarModelo({ isPdf: true });

    expect(modelo.options).not.toHaveProperty("reasoning");
    expect(modelo.options).toEqual({
      plugins: [
        { id: "file-parser", pdf: { engine: "native" } },
        { id: "response-healing" },
      ],
    });
  });

  it("usa o modelo do env como model id efetivo", () => {
    vi.stubEnv("OPENROUTER_MODEL", "modelo-do-env");

    const modelo = gerarModelo();

    expect(criarModelo).toHaveBeenCalledWith(
      "modelo-do-env",
      expect.any(Object),
    );
    expect(modelo.modelId).toBe("modelo-do-env");
  });

  it("prioriza o override do tenant no model id efetivo", () => {
    vi.stubEnv("OPENROUTER_MODEL", "modelo-do-env");

    const modelo = gerarModelo({
      overrides: { model: "modelo-do-tenant" },
    });

    expect(criarModelo).toHaveBeenCalledWith(
      "modelo-do-tenant",
      expect.any(Object),
    );
    expect(modelo.modelId).toBe("modelo-do-tenant");
  });
});

describe("shouldFallbackPdfEngine", () => {
  it.each([401, 403, 429])(
    "não faz fallback para status %i mesmo com erro de PDF",
    (status) => {
      expect(
        shouldFallbackPdfEngine(
          Object.assign(new Error("failed to parse PDF document"), {
            statusCode: status,
          }),
        ),
      ).toBe(false);
    },
  );

  it("não faz fallback para status HTTP em status (429)", () => {
    expect(
      shouldFallbackPdfEngine(
        Object.assign(new Error("failed to parse PDF"), { status: 429 }),
      ),
    ).toBe(false);
  });

  it.each([
    "api key inválida",
    "API KEY ausente",
    "unauthorized request",
    "Unauthorized",
    "forbidden",
    "OPENROUTER_API_KEY não configurada",
    "rate limit atingido",
    "rate-limit atingido",
    "Rate Limit excedido",
  ])("não faz fallback para erro de auth/quota: %s", (mensagem) => {
    expect(shouldFallbackPdfEngine(new Error(mensagem))).toBe(false);
  });

  it.each([
    "failed to parse",
    "PDF parse failed",
    "file parser error",
    "file-parser error",
    "unsupported file",
    "unsupported PDF",
    "unsupported document",
    "document unsupported",
    "file not supported",
    "unable to process file",
    "unable to read PDF",
    "unable to parse document",
  ])("faz fallback para sinal de parse/file: %s", (mensagem) => {
    expect(shouldFallbackPdfEngine(new Error(mensagem))).toBe(true);
  });

  it("faz fallback quando o responseBody do erro traz sinal de parse", () => {
    const erro = Object.assign(new Error("Provider returned an error"), {
      responseBody: "failed to parse the PDF file",
    });

    expect(shouldFallbackPdfEngine(erro)).toBe(true);
  });

  it("faz fallback para objeto com responseBody de arquivo não suportado", () => {
    expect(
      shouldFallbackPdfEngine({ responseBody: "unsupported file" }),
    ).toBe(true);
  });

  it("faz fallback para status 500 com responseBody de parse", () => {
    expect(
      shouldFallbackPdfEngine({
        statusCode: 500,
        responseBody: "failed to parse document",
      }),
    ).toBe(true);
  });

  it("ignora status não numérico e usa o responseBody", () => {
    expect(
      shouldFallbackPdfEngine({
        statusCode: "401",
        responseBody: "failed to parse PDF",
      }),
    ).toBe(true);
    expect(
      shouldFallbackPdfEngine({
        status: "429",
        responseBody: "failed to parse PDF",
      }),
    ).toBe(true);
  });

  it("não faz fallback para erro genérico sem sinal de parse", () => {
    expect(
      shouldFallbackPdfEngine(new Error("Provider returned an error")),
    ).toBe(false);
    expect(
      shouldFallbackPdfEngine(new Error("Internal server error")),
    ).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["objeto vazio", {}],
    ["objeto simples com message", { message: "failed to parse PDF" }],
    ["responseBody vazio", { responseBody: "" }],
    ["responseBody nulo", { responseBody: null }],
    ["string genérica", "algo deu errado"],
  ])("não faz fallback para %s", (_rotulo, erro) => {
    expect(shouldFallbackPdfEngine(erro)).toBe(false);
  });

  it("faz fallback quando o erro é uma string com sinal de parse", () => {
    expect(shouldFallbackPdfEngine("unsupported document")).toBe(true);
  });
});
