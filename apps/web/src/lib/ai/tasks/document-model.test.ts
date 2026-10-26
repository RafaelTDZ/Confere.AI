import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
} from "@/lib/ai/tasks/document-model";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/ai/providers/openrouter-model";

const mocks = vi.hoisted(() => ({
  createOpenRouterClient: vi.fn(),
  createFireworksClient: vi.fn(),
}));

vi.mock("@/lib/ai/providers/openrouter", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

vi.mock("@/lib/ai/providers/fireworks", () => ({
  createFireworksClient: mocks.createFireworksClient,
}));

type ModeloCriado = {
  modelId: string;
  options?: unknown;
};

const criarModelo = vi.fn((modelId: string, options?: unknown) => ({
  modelId,
  options,
}));

const criarModeloFireworks = vi.fn((modelId: string) => ({ modelId }));

function gerarModelo(options?: {
  provider?: "fireworks" | "openrouter";
  modelId?: string;
  isPdf?: boolean;
  pdfEngine?: "native" | "mistral-ocr";
}): ModeloCriado {
  return getDocumentLanguageModel({
    provider: options?.provider ?? "openrouter",
    modelId: options?.modelId ?? DEFAULT_OPENROUTER_MODEL,
    ...(options?.isPdf === undefined ? {} : { isPdf: options.isPdf }),
    ...(options?.pdfEngine === undefined
      ? {}
      : { pdfEngine: options.pdfEngine }),
  }) as unknown as ModeloCriado;
}

beforeEach(() => {
  criarModelo.mockClear();
  criarModeloFireworks.mockClear();
  mocks.createOpenRouterClient.mockReset();
  mocks.createOpenRouterClient.mockReturnValue(criarModelo);
  mocks.createFireworksClient.mockReset();
  mocks.createFireworksClient.mockReturnValue(criarModeloFireworks);
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

  it("assume não-PDF quando isPdf é omitido", () => {
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

  it("usa o modelId recebido no OpenRouter", () => {
    const modelo = gerarModelo({ modelId: "modelo-do-tenant" });

    expect(criarModelo).toHaveBeenCalledWith(
      "modelo-do-tenant",
      expect.any(Object),
    );
    expect(modelo.modelId).toBe("modelo-do-tenant");
  });

  it("usa o client Fireworks sem plugins nem reasoning", () => {
    const modelo = gerarModelo({
      provider: "fireworks",
      modelId: "accounts/fireworks/routers/deepseek-flash-latest",
      isPdf: true,
      pdfEngine: "mistral-ocr",
    });

    expect(mocks.createFireworksClient).toHaveBeenCalledTimes(1);
    expect(mocks.createFireworksClient).toHaveBeenCalledWith();
    expect(criarModeloFireworks).toHaveBeenCalledWith(
      "accounts/fireworks/routers/deepseek-flash-latest",
    );
    expect(mocks.createOpenRouterClient).not.toHaveBeenCalled();
    expect(criarModelo).not.toHaveBeenCalled();
    expect(modelo).toEqual({
      modelId: "accounts/fireworks/routers/deepseek-flash-latest",
    });
  });

  it("não monta reasoning no Fireworks mesmo com env configurado", () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "high");

    const modelo = gerarModelo({ provider: "fireworks", modelId: "fw-model" });

    expect(modelo).toEqual({ modelId: "fw-model" });
    expect(mocks.createOpenRouterClient).not.toHaveBeenCalled();
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
