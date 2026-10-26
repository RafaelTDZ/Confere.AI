import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreparedDocument } from "@/lib/ai/document-content";
import { packingListExtractionSchema } from "@/lib/ai/schemas";
import { extractPackingList } from "@/lib/ai/tasks/extract-packing-list";

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
  messages?: Array<{ content?: Array<Record<string, unknown>> }>;
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

beforeEach(() => {
  mocks.generateText.mockReset();
  mocks.outputObject.mockClear();
  mocks.getDocumentLanguageModel.mockClear();
  mocks.shouldFallbackPdfEngine.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("extractPackingList", () => {
  it("normaliza o número da invoice e devolve model, tokens e usage", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({ invoiceNumber: "  INV   123  " }),
    );

    const resultado = await extractPackingList(PREPARED_PDF);

    expect(resultado.packingList).toEqual({ invoiceNumber: "INV 123" });
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
  });

  it("usa o schema de extração do Packing List e envia o conteúdo preparado", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({ invoiceNumber: "INV-1" }),
    );

    await extractPackingList(PREPARED_PDF);

    expect(mocks.outputObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: packingListExtractionSchema,
        name: "packing_list_extraction",
      }),
    );
    expect(opcoesDaChamada(0).output?.schema).toBe(
      packingListExtractionSchema,
    );
    expect(opcoesDaChamada(0).messages?.[0]?.content?.[1]).toEqual(
      PREPARED_PDF.content[0],
    );
  });

  it.each([
    ["vazio", ""],
    ["apenas espaços", "   "],
    ["null", null],
  ])("retorna invoiceNumber null quando o valor é %s", async (_rotulo, valor) => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({ invoiceNumber: valor }),
    );

    const resultado = await extractPackingList(PREPARED_PDF);

    expect(resultado.packingList).toEqual({ invoiceNumber: null });
  });

  it("rejeita quando a IA não retorna dados do Packing List", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(null));

    await expect(extractPackingList(PREPARED_PDF)).rejects.toThrow(
      "A IA não retornou dados do Packing List",
    );
  });

  it("refaz com mistral-ocr quando o PDF falha no engine native", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText
      .mockRejectedValueOnce(erro)
      .mockResolvedValueOnce(
        resultadoComSucesso({ invoiceNumber: "INV-9" }),
      );
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    const resultado = await extractPackingList(PREPARED_PDF);

    expect(resultado.packingList).toEqual({ invoiceNumber: "INV-9" });
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

  it("propaga o erro de imagem sem tentar fallback de PDF", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText.mockRejectedValue(erro);
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    await expect(extractPackingList(PREPARED_IMAGE)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).not.toHaveBeenCalled();
  });
});
