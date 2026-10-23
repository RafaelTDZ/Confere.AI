import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceExtraction } from "@/lib/ai/schemas";
import { invoiceExtractionSchema } from "@/lib/ai/schemas";
import { extractInvoice } from "@/lib/ai/tasks/extract-invoice";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  outputObject: vi.fn((options: unknown) => options),
  getDocumentLanguageModel: vi.fn(
    (options?: {
      isPdf?: boolean;
      pdfEngine?: string;
      overrides?: unknown;
    }) => ({
      modelId: "model-x",
      options,
    }),
  ),
  shouldFallbackPdfEngine: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: { object: mocks.outputObject },
}));

vi.mock("@/lib/ai/tasks/document-model", () => ({
  getDocumentLanguageModel: mocks.getDocumentLanguageModel,
  shouldFallbackPdfEngine: mocks.shouldFallbackPdfEngine,
}));

vi.mock("@/lib/ai/provider", () => ({
  getAiModelId: () => "model-x",
  getAiProvider: () => "openrouter",
}));

type ChamadaGenerateText = {
  output?: { schema?: unknown; name?: string };
};

function opcoesDaChamada(indice: number): ChamadaGenerateText {
  return (mocks.generateText.mock.calls[indice]?.[0] ??
    {}) as ChamadaGenerateText;
}

const ENDERECO_VAZIO = {
  street: null,
  number: null,
  complement: null,
  postalCode: null,
  city: null,
  state: null,
  country: null,
  other: null,
};

const INVOICE: InvoiceExtraction = {
  number: " INV-001 ",
  blNumber: null,
  exporter: { name: "acme export" },
  importer: {
    name: "importadora xyz",
    cnpj: "12.345.678/0001-90",
    address: {
      street: "Rua A",
      number: "10",
      complement: null,
      postalCode: "01000-000",
      city: "São Paulo",
      state: "SP",
      country: "Brasil",
      other: null,
    },
  },
  notify: {
    name: null,
    cnpj: null,
    address: ENDERECO_VAZIO,
  },
  products: [
    { code: "SKU-1", ncm: "8471.30.12", description: "Notebook" },
  ],
};

function resultadoComSucesso(output: unknown) {
  return {
    output,
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      outputTokenDetails: { reasoningTokens: 1 },
    },
    providerMetadata: {
      openrouter: { usage: { cost: 0.01 } },
    },
  };
}

const ENTRADA_PDF = {
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "application/pdf",
  filename: "doc.pdf",
};

const ENTRADA_IMAGEM = {
  bytes: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
  filename: "doc.png",
};

beforeEach(() => {
  mocks.generateText.mockReset();
  mocks.outputObject.mockClear();
  mocks.getDocumentLanguageModel.mockClear();
  mocks.shouldFallbackPdfEngine.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("extractInvoice", () => {
  it("extrai a invoice com model, tokens e usage", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(INVOICE));

    const resultado = await extractInvoice(ENTRADA_PDF);

    expect(resultado.invoice).toEqual(INVOICE);
    expect(resultado.model).toBe("model-x");
    expect(resultado.tokensIn).toBe(10);
    expect(resultado.tokensOut).toBe(4);
    expect(resultado.usage).toEqual({
      tokensIn: 10,
      tokensOut: 4,
      reasoningTokens: 1,
      costUsd: 0.01,
      latencyMs: expect.any(Number),
    });
    expect(resultado.latencyMs).toBe(resultado.usage.latencyMs);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.getDocumentLanguageModel).toHaveBeenCalledWith({
      isPdf: true,
      pdfEngine: "native",
      overrides: undefined,
    });
  });

  it("usa o schema de extração de invoice", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(INVOICE));

    await extractInvoice(ENTRADA_PDF);

    expect(mocks.outputObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: invoiceExtractionSchema,
        name: "invoice_extraction",
      }),
    );
    expect(opcoesDaChamada(0).output?.schema).toBe(invoiceExtractionSchema);
  });

  it("rejeita quando a IA não retorna dados da invoice", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(null));

    await expect(extractInvoice(ENTRADA_PDF)).rejects.toThrow(
      "A IA não retornou dados da invoice",
    );
  });

  it("refaz com mistral-ocr quando o PDF falha no engine native", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText
      .mockRejectedValueOnce(erro)
      .mockResolvedValueOnce(resultadoComSucesso(INVOICE));
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    const resultado = await extractInvoice(ENTRADA_PDF);

    expect(resultado.invoice).toEqual(INVOICE);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.shouldFallbackPdfEngine).toHaveBeenCalledWith(erro);
    expect(mocks.getDocumentLanguageModel).toHaveBeenNthCalledWith(1, {
      isPdf: true,
      pdfEngine: "native",
      overrides: undefined,
    });
    expect(mocks.getDocumentLanguageModel).toHaveBeenNthCalledWith(2, {
      isPdf: true,
      pdfEngine: "mistral-ocr",
      overrides: undefined,
    });
  });

  it("propaga o erro do PDF sem sinal de fallback e não refaz", async () => {
    const erro = new Error("provider indisponível");
    mocks.generateText.mockRejectedValue(erro);
    mocks.shouldFallbackPdfEngine.mockReturnValue(false);

    await expect(extractInvoice(ENTRADA_PDF)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).toHaveBeenCalledWith(erro);
  });

  it("propaga o erro de imagem sem tentar fallback de PDF", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText.mockRejectedValue(erro);
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    await expect(extractInvoice(ENTRADA_IMAGEM)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).not.toHaveBeenCalled();
  });

  it("encaminha os overrides do tenant para o modelo", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(INVOICE));

    await extractInvoice(ENTRADA_PDF, { model: "modelo-do-tenant" });

    expect(mocks.getDocumentLanguageModel).toHaveBeenCalledWith({
      isPdf: true,
      pdfEngine: "native",
      overrides: { model: "modelo-do-tenant" },
    });
  });
});
