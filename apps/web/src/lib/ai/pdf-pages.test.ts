import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PdfConversionError, renderPdfPages } from "@/lib/ai/pdf-pages";

const mocks = vi.hoisted(() => ({
  pdf: vi.fn(),
}));

vi.mock("pdf-to-img", () => ({
  pdf: mocks.pdf,
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function makeDoc(
  pages: Array<Uint8Array | Error>,
  destroy = vi.fn().mockResolvedValue(undefined),
) {
  const getPage = vi.fn(async (pageNumber: number) => {
    const page = pages[pageNumber - 1];
    if (page instanceof Error) throw page;
    return page ?? new Uint8Array();
  });

  return { length: pages.length, getPage, destroy };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Era esperado um PdfConversionError");
}

beforeEach(() => {
  mocks.pdf.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderPdfPages", () => {
  it("converte cada página em JPEG e libera o documento", async () => {
    const first = new Uint8Array([1, 2]);
    const second = new Uint8Array([3, 4, 5]);
    const doc = makeDoc([first, second]);
    mocks.pdf.mockResolvedValue(doc);

    const pages = await renderPdfPages(PDF_BYTES, "invoice.pdf");

    expect(mocks.pdf).toHaveBeenCalledWith(PDF_BYTES, {
      scale: 2,
      format: "jpg",
    });
    expect(pages).toEqual([
      {
        type: "file",
        mediaType: "image/jpeg",
        filename: "invoice-pagina-1.jpg",
        data: first,
      },
      {
        type: "file",
        mediaType: "image/jpeg",
        filename: "invoice-pagina-2.jpg",
        data: second,
      },
    ]);
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("usa o nome padrão quando o arquivo não é informado", async () => {
    const doc = makeDoc([new Uint8Array([1])]);
    mocks.pdf.mockResolvedValue(doc);

    const pages = await renderPdfPages(PDF_BYTES);
    const semNome = await renderPdfPages(PDF_BYTES, "  ");

    expect(pages[0]?.filename).toBe("documento-pagina-1.jpg");
    expect(semNome[0]?.filename).toBe("documento-pagina-1.jpg");
  });

  it("envolve falha ao abrir o PDF em PdfConversionError", async () => {
    const openError = new Error("Password required");
    mocks.pdf.mockRejectedValue(openError);

    const error = await captureError(renderPdfPages(PDF_BYTES));

    expect(error).toBeInstanceOf(PdfConversionError);
    expect(error.name).toBe("PdfConversionError");
    expect(error.message).toContain("Não foi possível converter o PDF");
    expect(error.message).toContain("OpenRouter");
    expect(error.cause).toBe(openError);
  });

  it("rejeita PDF sem páginas e libera o documento", async () => {
    const doc = makeDoc([]);
    mocks.pdf.mockResolvedValue(doc);

    const error = await captureError(renderPdfPages(PDF_BYTES));

    expect(error).toBeInstanceOf(PdfConversionError);
    expect(error.message).toContain("não tem páginas");
    expect(error.cause).toBeInstanceOf(Error);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejeita PDF acima do limite de páginas sem renderizar", async () => {
    const pages = Array.from({ length: 31 }, () => new Uint8Array([1]));
    const doc = makeDoc(pages);
    mocks.pdf.mockResolvedValue(doc);

    const error = await captureError(renderPdfPages(PDF_BYTES));

    expect(error).toBeInstanceOf(PdfConversionError);
    expect(error.message).toContain("31 páginas");
    expect(error.message).toContain("limite é 30");
    expect(doc.getPage).not.toHaveBeenCalled();
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejeita quando as imagens passam do limite de tamanho", async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const doc = makeDoc([chunk, chunk]);
    mocks.pdf.mockResolvedValue(doc);

    const error = await captureError(renderPdfPages(PDF_BYTES));

    expect(error).toBeInstanceOf(PdfConversionError);
    expect(error.message).toContain("~7 MB");
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("envolve falha de renderização de uma página", async () => {
    const pageError = new Error("canvas explodiu");
    const doc = makeDoc([new Uint8Array([1]), pageError]);
    mocks.pdf.mockResolvedValue(doc);

    const error = await captureError(renderPdfPages(PDF_BYTES));

    expect(error).toBeInstanceOf(PdfConversionError);
    expect(error.message).toContain("página 2");
    expect(error.cause).toBe(pageError);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejeita página sem imagem", async () => {
    const doc = makeDoc([new Uint8Array()]);
    mocks.pdf.mockResolvedValue(doc);

    const error = await captureError(renderPdfPages(PDF_BYTES));

    expect(error).toBeInstanceOf(PdfConversionError);
    expect(error.message).toContain("página 1");
    expect(error.cause).toBeInstanceOf(Error);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("mantém as páginas quando só o destroy falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const doc = makeDoc(
      [new Uint8Array([1])],
      vi.fn().mockRejectedValue(new Error("destroy falhou")),
    );
    mocks.pdf.mockResolvedValue(doc);

    const pages = await renderPdfPages(PDF_BYTES, "nota");

    expect(pages).toHaveLength(1);
    expect(pages[0]?.filename).toBe("nota-pagina-1.jpg");
    expect(consoleError).toHaveBeenCalled();
  });
});
