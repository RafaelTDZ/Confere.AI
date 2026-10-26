import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreparedDocument } from "@/lib/ai/document-content";
import { documentClassificationSchema } from "@/lib/ai/schemas";
import { classifyDocument } from "@/lib/ai/tasks/classify";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  outputObject: vi.fn((options: unknown) => options),
  getDocumentLanguageModel: vi.fn(
    (options?: {
      provider?: string;
      modelId?: string;
      isPdf?: boolean;
      pdfEngine?: string;
    }) => ({
      modelId: options?.modelId,
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

type ChamadaGenerateText = {
  output?: { schema?: unknown; name?: string };
  messages?: Array<{
    role?: string;
    content?: Array<Record<string, unknown>>;
  }>;
};

function opcoesDaChamada(indice: number): ChamadaGenerateText {
  return (mocks.generateText.mock.calls[indice]?.[0] ??
    {}) as ChamadaGenerateText;
}

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

const PDF_BYTES = new Uint8Array([1, 2, 3]);

const PREPARED_PDF: PreparedDocument = {
  provider: "openrouter",
  modelId: "model-doc",
  isPdf: true,
  filename: "doc.pdf",
  content: [
    {
      type: "file",
      mediaType: "application/pdf",
      filename: "doc.pdf",
      data: PDF_BYTES,
    },
  ],
};

const PREPARED_IMAGE: PreparedDocument = {
  provider: "openrouter",
  modelId: "model-doc",
  isPdf: false,
  filename: "doc.png",
  content: [
    {
      type: "file",
      mediaType: "image/png",
      filename: "doc.png",
      data: PDF_BYTES,
    },
  ],
};

const PREPARED_FIREWORKS_PDF: PreparedDocument = {
  provider: "fireworks",
  modelId: "fw-model",
  isPdf: true,
  filename: "doc.pdf",
  content: [
    {
      type: "file",
      mediaType: "image/jpeg",
      filename: "doc-pagina-1.jpg",
      data: PDF_BYTES,
    },
  ],
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

describe("classifyDocument", () => {
  it("classifica, deduplica tipos e devolve model, tokens e usage", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        types: ["invoice", "invoice", "packing_list"],
        notes: null,
      }),
    );

    const resultado = await classifyDocument(PREPARED_PDF);

    expect(resultado.classification).toEqual({
      types: ["invoice", "packing_list"],
      notes: null,
    });
    expect(resultado.model).toBe("model-doc");
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
      provider: "openrouter",
      modelId: "model-doc",
      isPdf: true,
      pdfEngine: "native",
    });
    expect(mocks.shouldFallbackPdfEngine).not.toHaveBeenCalled();
  });

  it("usa o schema de classificação e envia o conteúdo preparado", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({ types: ["invoice"], notes: null }),
    );

    await classifyDocument(PREPARED_PDF);

    const chamada = opcoesDaChamada(0);

    expect(mocks.outputObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: documentClassificationSchema,
        name: "document_classification",
      }),
    );
    expect(chamada.output?.schema).toBe(documentClassificationSchema);
    expect(chamada.messages?.[0]?.role).toBe("user");
    expect(chamada.messages?.[0]?.content).toEqual([
      { type: "text", text: expect.any(String) },
      PREPARED_PDF.content[0],
    ]);
  });

  it("envia as páginas convertidas quando o prepared vem do Fireworks", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({ types: ["invoice"], notes: null }),
    );

    const resultado = await classifyDocument(PREPARED_FIREWORKS_PDF);

    expect(resultado.model).toBe("fw-model");
    expect(opcoesDaChamada(0).messages?.[0]?.content?.[1]).toEqual(
      PREPARED_FIREWORKS_PDF.content[0],
    );
    expect(mocks.getDocumentLanguageModel).toHaveBeenCalledWith({
      provider: "fireworks",
      modelId: "fw-model",
      isPdf: true,
      pdfEngine: "native",
    });
  });

  it.each([
    ["lista vazia", { types: [], notes: null }],
    ["output nulo", null],
    ["output sem types", { notes: null }],
  ])("rejeita quando os tipos são %s", async (_rotulo, output) => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(output));

    await expect(classifyDocument(PREPARED_PDF)).rejects.toThrow(
      "A IA não identificou nenhum tipo de documento",
    );
  });

  it("refaz com mistral-ocr quando o PDF falha no engine native", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText
      .mockRejectedValueOnce(erro)
      .mockResolvedValueOnce(
        resultadoComSucesso({ types: ["bill_of_lading"], notes: null }),
      );
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    const resultado = await classifyDocument(PREPARED_PDF);

    expect(resultado.classification.types).toEqual(["bill_of_lading"]);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.shouldFallbackPdfEngine).toHaveBeenCalledWith(erro);
    expect(mocks.getDocumentLanguageModel).toHaveBeenNthCalledWith(1, {
      provider: "openrouter",
      modelId: "model-doc",
      isPdf: true,
      pdfEngine: "native",
    });
    expect(mocks.getDocumentLanguageModel).toHaveBeenNthCalledWith(2, {
      provider: "openrouter",
      modelId: "model-doc",
      isPdf: true,
      pdfEngine: "mistral-ocr",
    });
  });

  it("propaga o erro do PDF sem sinal de fallback e não refaz", async () => {
    const erro = new Error("provider indisponível");
    mocks.generateText.mockRejectedValue(erro);
    mocks.shouldFallbackPdfEngine.mockReturnValue(false);

    await expect(classifyDocument(PREPARED_PDF)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).toHaveBeenCalledWith(erro);
  });

  it("não tenta fallback de OCR no Fireworks", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText.mockRejectedValue(erro);
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    await expect(classifyDocument(PREPARED_FIREWORKS_PDF)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).not.toHaveBeenCalled();
  });

  it("propaga o erro de imagem sem tentar fallback de PDF", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText.mockRejectedValue(erro);
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    await expect(classifyDocument(PREPARED_IMAGE)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).not.toHaveBeenCalled();
    expect(mocks.getDocumentLanguageModel).toHaveBeenCalledWith({
      provider: "openrouter",
      modelId: "model-doc",
      isPdf: false,
      pdfEngine: "native",
    });
  });
});
