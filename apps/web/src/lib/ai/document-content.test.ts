import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  prepareDocument,
  type PreparedDocument,
} from "@/lib/ai/document-content";
import type { AnalyzeFileInput } from "@/lib/ai/tasks/classify";

const mocks = vi.hoisted(() => ({
  renderPdfPages: vi.fn(),
  getAiProvider: vi.fn(),
  getAiModelId: vi.fn(),
}));

vi.mock("@/lib/ai/pdf-pages", () => ({
  renderPdfPages: mocks.renderPdfPages,
}));

vi.mock("@/lib/ai/provider", () => ({
  getAiProvider: mocks.getAiProvider,
  getAiModelId: mocks.getAiModelId,
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const ARQUIVO_PDF: AnalyzeFileInput = {
  bytes: PDF_BYTES,
  mediaType: "application/pdf",
  filename: "invoice.pdf",
};

const ARQUIVO_IMAGEM: AnalyzeFileInput = {
  bytes: PDF_BYTES,
  mediaType: "image/png",
  filename: "invoice.png",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAiProvider.mockReturnValue("fireworks");
  mocks.getAiModelId.mockReturnValue("model-default");
  mocks.renderPdfPages.mockResolvedValue([
    {
      type: "file",
      mediaType: "image/jpeg",
      filename: "invoice-pagina-1.jpg",
      data: new Uint8Array([1]),
    },
  ]);
});

describe("prepareDocument", () => {
  it("converte o PDF em imagens no Fireworks", async () => {
    const prepared: PreparedDocument = await prepareDocument(ARQUIVO_PDF, {
      provider: "fireworks",
    });

    expect(mocks.renderPdfPages).toHaveBeenCalledWith(PDF_BYTES, "invoice.pdf");
    expect(prepared).toEqual({
      provider: "fireworks",
      modelId: "model-default",
      isPdf: true,
      filename: "invoice.pdf",
      content: [
        {
          type: "file",
          mediaType: "image/jpeg",
          filename: "invoice-pagina-1.jpg",
          data: new Uint8Array([1]),
        },
      ],
    });
  });

  it("mantém o PDF como file part no OpenRouter", async () => {
    mocks.getAiProvider.mockReturnValue("openrouter");

    const prepared = await prepareDocument(ARQUIVO_PDF, {
      provider: "openrouter",
      model: "model-or",
    });

    expect(mocks.renderPdfPages).not.toHaveBeenCalled();
    expect(prepared).toEqual({
      provider: "openrouter",
      modelId: "model-default",
      isPdf: true,
      filename: "invoice.pdf",
      content: [
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "invoice.pdf",
          data: PDF_BYTES,
        },
      ],
    });
  });

  it("mantém o media type original da imagem", async () => {
    const prepared = await prepareDocument(ARQUIVO_IMAGEM);

    expect(mocks.renderPdfPages).not.toHaveBeenCalled();
    expect(prepared.isPdf).toBe(false);
    expect(prepared.content).toEqual([
      {
        type: "file",
        mediaType: "image/png",
        filename: "invoice.png",
        data: PDF_BYTES,
      },
    ]);
  });

  it("decide provider e modelo com os overrides recebidos", async () => {
    const overrides = { provider: "openrouter" as const, model: "model-x" };

    await prepareDocument(ARQUIVO_IMAGEM, overrides);

    expect(mocks.getAiProvider).toHaveBeenCalledWith(overrides);
    expect(mocks.getAiModelId).toHaveBeenCalledWith(overrides);
  });

  it("propaga falha da conversão de PDF", async () => {
    const erro = new Error("PDF protegido");
    mocks.renderPdfPages.mockRejectedValue(erro);

    await expect(prepareDocument(ARQUIVO_PDF)).rejects.toBe(erro);
  });
});
