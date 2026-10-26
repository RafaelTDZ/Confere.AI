import "server-only";

import type { FilePart } from "ai";
import { renderPdfPages } from "@/lib/ai/pdf-pages";
import {
  getAiModelId,
  getAiProvider,
  type AiOverrides,
  type AiProviderId,
} from "@/lib/ai/provider";

/** Arquivo recebido para análise (bytes já normalizados pelo pipeline). */
export type AnalyzeFileInput = {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
};

/**
 * Documento pronto para as tasks de IA: provider/modelo decididos uma única
 * vez e conteúdo no formato que o provider aceita.
 */
export type PreparedDocument = {
  provider: AiProviderId;
  modelId: string;
  isPdf: boolean;
  filename: string;
  content: FilePart[];
};

const PDF_MEDIA_TYPE = "application/pdf";

/**
 * Prepara o conteúdo do documento uma vez por análise:
 * - Fireworks + PDF → páginas convertidas em JPEG (a API não aceita PDF);
 * - OpenRouter + PDF → um `FilePart` application/pdf (file-parser/OCR);
 * - imagem → `FilePart` com o media type original.
 */
export async function prepareDocument(
  file: AnalyzeFileInput,
  overrides?: AiOverrides,
): Promise<PreparedDocument> {
  const provider = getAiProvider(overrides);
  const modelId = getAiModelId(overrides);
  const isPdf = file.mediaType === PDF_MEDIA_TYPE;

  let content: FilePart[];
  if (isPdf && provider === "fireworks") {
    content = await renderPdfPages(file.bytes, file.filename);
  } else {
    content = [
      {
        type: "file",
        mediaType: file.mediaType,
        filename: file.filename,
        data: file.bytes,
      },
    ];
  }

  return { provider, modelId, isPdf, filename: file.filename, content };
}
