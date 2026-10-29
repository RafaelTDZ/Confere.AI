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
  isDocumentParseEnabled: vi.fn(),
  parsePdfWithFirecrawl: vi.fn(),
  documentParseMaxChars: vi.fn(),
}));

vi.mock("@/lib/ai/pdf-pages", () => ({
  renderPdfPages: mocks.renderPdfPages,
}));

vi.mock("@/lib/ai/provider", () => ({
  getAiProvider: mocks.getAiProvider,
  getAiModelId: mocks.getAiModelId,
}));

vi.mock("@/lib/ai/document-parse", () => ({
  isDocumentParseEnabled: mocks.isDocumentParseEnabled,
  parsePdfWithFirecrawl: mocks.parsePdfWithFirecrawl,
  documentParseMaxChars: mocks.documentParseMaxChars,
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

const PARSE_CONTEXT = { tenantId: "tenant-1", sha256: "sha-abc" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAiProvider.mockReturnValue("fireworks");
  mocks.getAiModelId.mockReturnValue("model-default");
  mocks.isDocumentParseEnabled.mockReturnValue(true);
  mocks.documentParseMaxChars.mockReturnValue(1000);
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
  it("usa o markdown do parse quando disponível", async () => {
    mocks.parsePdfWithFirecrawl.mockResolvedValue({
      ok: true,
      document: {
        markdown: "# BL\n\nContainer TCKU1234567",
        pages: 2,
        credits: 2,
        cached: false,
      },
    });

    const prepared: PreparedDocument = await prepareDocument(
      ARQUIVO_PDF,
      { provider: "fireworks" },
      PARSE_CONTEXT,
    );

    expect(mocks.parsePdfWithFirecrawl).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      sha256: "sha-abc",
      bytes: PDF_BYTES,
      filename: "invoice.pdf",
    });
    expect(mocks.renderPdfPages).not.toHaveBeenCalled();
    expect(prepared.isPdf).toBe(false);
    expect(prepared.parse).toEqual({
      source: "firecrawl",
      pages: 2,
      chars: 27,
      cached: false,
    });
    expect(prepared.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Container TCKU1234567"),
      },
    ]);
  });

  it("cai para imagens quando o parse falha", async () => {
    mocks.parsePdfWithFirecrawl.mockResolvedValue({
      ok: false,
      errorCode: "parse_too_short",
      errorMessage: "Markdown vazio",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const prepared = await prepareDocument(
      ARQUIVO_PDF,
      { provider: "fireworks" },
      PARSE_CONTEXT,
    );

    expect(mocks.renderPdfPages).toHaveBeenCalledWith(PDF_BYTES, "invoice.pdf");
    expect(prepared.isPdf).toBe(true);
    expect(prepared.parse).toBeNull();
    expect(prepared.content).toEqual([
      {
        type: "file",
        mediaType: "image/jpeg",
        filename: "invoice-pagina-1.jpg",
        data: new Uint8Array([1]),
      },
    ]);
  });

  it("não chama o parse quando está desabilitado", async () => {
    mocks.isDocumentParseEnabled.mockReturnValue(false);

    await prepareDocument(ARQUIVO_PDF, { provider: "fireworks" }, PARSE_CONTEXT);

    expect(mocks.parsePdfWithFirecrawl).not.toHaveBeenCalled();
    expect(mocks.renderPdfPages).toHaveBeenCalled();
  });

  it("não chama o parse sem contexto de tenant/sha", async () => {
    await prepareDocument(ARQUIVO_PDF, { provider: "fireworks" });

    expect(mocks.parsePdfWithFirecrawl).not.toHaveBeenCalled();
    expect(mocks.renderPdfPages).toHaveBeenCalled();
  });

  it("cai para imagens quando o parse lança erro", async () => {
    mocks.parsePdfWithFirecrawl.mockRejectedValue(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const prepared = await prepareDocument(
      ARQUIVO_PDF,
      { provider: "fireworks" },
      PARSE_CONTEXT,
    );

    expect(mocks.renderPdfPages).toHaveBeenCalled();
    expect(prepared.parse).toBeNull();
  });

  it("converte o PDF em imagens no Fireworks sem parse", async () => {
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
      parse: null,
    });
  });

  it("mantém o PDF como file part no OpenRouter sem parse", async () => {
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
      parse: null,
    });
  });

  it("mantém o media type original da imagem", async () => {
    const prepared = await prepareDocument(ARQUIVO_IMAGEM);

    expect(mocks.parsePdfWithFirecrawl).not.toHaveBeenCalled();
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
    expect(prepared.parse).toBeNull();
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
