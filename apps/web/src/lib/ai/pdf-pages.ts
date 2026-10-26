import "server-only";

// Import estático: o pdfjs-dist faz `require("@napi-rs/canvas")` em runtime
// (dentro de um try/catch). Sem esta referência, o tracer da Vercel não inclui
// o pacote nativo no bundle da função e a conversão falha com "Cannot find
// module '@napi-rs/canvas'".
import "@napi-rs/canvas";
import type { FilePart } from "ai";
import { pdf } from "pdf-to-img";

/** Máximo de páginas por análise (custo/latência do worker). */
const MAX_PDF_PAGES = 30;

/** Máximo somando os JPEGs crus (~base64 fica abaixo do teto de 10 MB). */
const MAX_RENDERED_BYTES = 7 * 1024 * 1024;

/** ~144 DPI: legível para o modelo e ainda dentro do limite de tamanho. */
const PDF_PAGE_SCALE = 2;

const PDF_FALLBACK_HINT =
  "Selecione OpenRouter ou envie o documento como PNG/JPG.";

/**
 * Falha acionável na conversão de PDF em imagens. A mensagem vai direto para
 * `ai_jobs.error_message` e aparece no polling do dropzone.
 */
export class PdfConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PdfConversionError";
  }
}

function pageImageName(filename: string, pageNumber: number): string {
  const base = filename.replace(/\.[^./\\]+$/, "").trim() || "documento";
  return `${base}-pagina-${pageNumber}.jpg`;
}

/**
 * Converte as páginas do PDF em JPEGs para o provider que não aceita PDF
 * (Fireworks). Sempre libera o documento, mesmo em caso de erro.
 *
 * @param bytes conteúdo do PDF
 * @param filename nome original, usado no `filename` de cada página
 */
export async function renderPdfPages(
  bytes: Uint8Array,
  filename = "documento",
): Promise<FilePart[]> {
  let doc: Awaited<ReturnType<typeof pdf>>;
  try {
    doc = await pdf(bytes, { scale: PDF_PAGE_SCALE, format: "jpg" });
  } catch (error) {
    throw new PdfConversionError(
      `Não foi possível converter o PDF em imagens (arquivo protegido ou corrompido). ${PDF_FALLBACK_HINT}`,
      { cause: error },
    );
  }

  try {
    if (doc.length === 0) {
      throw new PdfConversionError(
        `O PDF não tem páginas para converter. ${PDF_FALLBACK_HINT}`,
        { cause: new Error("PDF sem páginas") },
      );
    }

    if (doc.length > MAX_PDF_PAGES) {
      throw new PdfConversionError(
        `O PDF tem ${doc.length} páginas; o limite é ${MAX_PDF_PAGES}. ${PDF_FALLBACK_HINT}`,
        { cause: new Error(`PDF com ${doc.length} páginas`) },
      );
    }

    const pages: FilePart[] = [];
    let renderedBytes = 0;

    for (let pageNumber = 1; pageNumber <= doc.length; pageNumber += 1) {
      let image: Uint8Array;
      try {
        image = await doc.getPage(pageNumber);
      } catch (error) {
        throw new PdfConversionError(
          `Não foi possível converter a página ${pageNumber} do PDF em imagem. ${PDF_FALLBACK_HINT}`,
          { cause: error },
        );
      }

      if (image.byteLength === 0) {
        throw new PdfConversionError(
          `A página ${pageNumber} do PDF não gerou imagem. ${PDF_FALLBACK_HINT}`,
          { cause: new Error("Página vazia") },
        );
      }

      renderedBytes += image.byteLength;
      if (renderedBytes > MAX_RENDERED_BYTES) {
        throw new PdfConversionError(
          `As imagens do PDF passaram de ~7 MB. ${PDF_FALLBACK_HINT}`,
          { cause: new Error(`Imagens somam ${renderedBytes} bytes`) },
        );
      }

      pages.push({
        type: "file",
        mediaType: "image/jpeg",
        filename: pageImageName(filename, pageNumber),
        data: image,
      });
    }

    return pages;
  } finally {
    try {
      await doc.destroy();
    } catch (destroyError) {
      console.error(
        "[pdf-pages] falha ao liberar o PDF convertido:",
        destroyError,
      );
    }
  }
}
