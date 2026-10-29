import "server-only";

import type { FilePart } from "ai";
import {
  documentParseMaxChars,
  isDocumentParseEnabled,
  parsePdfWithFirecrawl,
} from "@/lib/ai/document-parse";
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

/** Texto vindo do parse de PDF (markdown) ou arquivo para os providers. */
type DocumentContentPart =
  | FilePart
  | { type: "text"; text: string };

/**
 * Documento pronto para as tasks de IA: provider/modelo decididos uma única
 * vez e conteúdo no formato que o provider aceita.
 */
export type PreparedDocument = {
  provider: AiProviderId;
  modelId: string;
  isPdf: boolean;
  filename: string;
  content: DocumentContentPart[];
  /** Metadados do parse de PDF, quando o markdown foi usado. */
  parse?: {
    source: "firecrawl";
    pages: number;
    chars: number;
    cached: boolean;
  } | null;
};

export type PrepareDocumentContext = {
  tenantId: string;
  sha256: string;
};

const PDF_MEDIA_TYPE = "application/pdf";

const TEXT_HEADER = [
  "O conteúdo abaixo foi convertido de PDF para markdown.",
  "Tabelas podem aparecer como HTML (<table>).",
  "Corrija erros óbvios de OCR usando o contexto do documento.",
  "",
].join("\n");

function buildTextContent(markdown: string, maxChars: number): string {
  const text =
    markdown.length > maxChars ? markdown.slice(0, maxChars) : markdown;
  return `${TEXT_HEADER}${text}`;
}

/**
 * Prepara o conteúdo do documento uma vez por análise:
 * - PDF + parse habilitado → markdown (Firecrawl `/v2/parse`, OCR fallback);
 * - PDF no Fireworks → páginas convertidas em JPEG (API não aceita PDF);
 * - PDF no OpenRouter → um `FilePart` application/pdf (file-parser/OCR);
 * - imagem → `FilePart` com o media type original.
 */
export async function prepareDocument(
  file: AnalyzeFileInput,
  overrides?: AiOverrides,
  parseContext?: PrepareDocumentContext,
): Promise<PreparedDocument> {
  const provider = getAiProvider(overrides);
  const modelId = getAiModelId(overrides);
  const isPdf = file.mediaType === PDF_MEDIA_TYPE;

  if (isPdf && parseContext && isDocumentParseEnabled()) {
    try {
      const parsed = await parsePdfWithFirecrawl({
        tenantId: parseContext.tenantId,
        sha256: parseContext.sha256,
        bytes: file.bytes,
        filename: file.filename,
      });

      if (parsed.ok) {
        return {
          provider,
          modelId,
          // Sem PDF/file part: o modelo recebe apenas texto.
          isPdf: false,
          filename: file.filename,
          content: [
            {
              type: "text",
              text: buildTextContent(
                parsed.document.markdown,
                documentParseMaxChars(),
              ),
            },
          ],
          parse: {
            source: "firecrawl",
            pages: parsed.document.pages,
            chars: parsed.document.markdown.length,
            cached: parsed.document.cached,
          },
        };
      }

      console.warn(
        "[document-content] parse de PDF indisponível, usando imagens:",
        parsed.errorCode,
        parsed.errorMessage,
      );
    } catch (error) {
      // Parse é acessório: qualquer falha cai no pipeline de imagens.
      console.error(
        "[document-content] falha inesperada no parse de PDF:",
        error,
      );
    }
  }

  let content: DocumentContentPart[];
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

  return {
    provider,
    modelId,
    isPdf,
    filename: file.filename,
    content,
    parse: null,
  };
}
