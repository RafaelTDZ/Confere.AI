import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreparedDocument } from "@/lib/ai/document-content";
import type { BlExtraction } from "@/lib/ai/schemas";
import { blExtractionSchema } from "@/lib/ai/schemas";
import { extractBl } from "@/lib/ai/tasks/extract-bl";

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

const ENDERECO = {
  street: "Rua A",
  number: "10",
  complement: null,
  postalCode: "01000-000",
  city: "São Paulo",
  state: "SP",
  country: "Brasil",
  other: null,
};

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

const BL_COMPLETO: BlExtraction = {
  number: "  bl-123  ",
  carrier: " maersk line ",
  shipper: " acme export co. ",
  consignee: " importadora xyz ltda ",
  consigneeDetails: {
    name: " importadora xyz ltda ",
    cnpj: " 12.345.678/0001-90 ",
    address: ENDERECO,
  },
  notifyParty: " notify co ",
  notifyPartyDetails: {
    name: " notify co ",
    cnpj: " 98.765.432/0001-10 ",
    address: ENDERECO,
  },
  polCity: " shanghai ",
  polCountry: " china ",
  podCity: " santos ",
  podCountry: " brasil ",
  vessel: " msc aurora ",
  voyage: " 123e ",
  descriptionOfGoods: " eletronic devices ",
  grossWeight: " 1.234,56 ",
  volumes: " 10 ",
  packages: " cartons ",
  measurement: " 12,5 ",
  freightValue: " 1.500,00 ",
  freightCurrency: " usd ",
  freightTerms: " prepaid ",
  freeTime: " 21 days ",
  ncm: [
    " 8471.30.12 ",
    "abc 8504.40.90 xyz",
    ".8517.62.00.",
    "",
    "   ",
    "SEM NUMERO",
  ],
  containerNumbers: [
    " mscu1234567 ",
    null as unknown as string,
    "",
    "  ",
  ],
  containerQuantity: " 2 ",
  containerType: " 40hc ",
  sealNumbers: [" s123 ", null as unknown as string, ""],
  onboardDate: " 2026-10-01T10:00:00Z ",
  eta: " 02/11/2026 ",
};

const BL_LIMPO: BlExtraction = {
  number: "BL-123",
  carrier: "MAERSK LINE",
  shipper: "ACME EXPORT CO.",
  consignee: "IMPORTADORA XYZ LTDA",
  consigneeDetails: {
    name: "IMPORTADORA XYZ LTDA",
    cnpj: "12.345.678/0001-90",
    address: ENDERECO,
  },
  notifyParty: "NOTIFY CO",
  notifyPartyDetails: {
    name: "NOTIFY CO",
    cnpj: "98.765.432/0001-10",
    address: ENDERECO,
  },
  polCity: "SHANGHAI",
  polCountry: "CHINA",
  podCity: "SANTOS",
  podCountry: "BRASIL",
  vessel: "MSC AURORA",
  voyage: "123E",
  descriptionOfGoods: "ELETRONIC DEVICES",
  grossWeight: "1.234,56",
  volumes: "10",
  packages: "CAIXAS",
  measurement: "12,5",
  freightValue: "1.500,00",
  freightCurrency: "USD",
  freightTerms: "PREPAID",
  freeTime: "21 DAYS",
  ncm: ["8471.30.12", "8504.40.90", "8517.62.00"],
  containerNumbers: ["MSCU1234567"],
  containerQuantity: "2",
  containerType: "40HC",
  sealNumbers: ["S123"],
  onboardDate: "2026-10-01T10:00:00Z",
  eta: "02/11/2026",
};

const BL_VAZIO: BlExtraction = {
  number: null,
  carrier: null,
  shipper: null,
  consignee: null,
  consigneeDetails: { name: null, cnpj: null, address: ENDERECO_VAZIO },
  notifyParty: null,
  notifyPartyDetails: { name: null, cnpj: null, address: ENDERECO_VAZIO },
  polCity: null,
  polCountry: null,
  podCity: null,
  podCountry: null,
  vessel: null,
  voyage: null,
  descriptionOfGoods: null,
  grossWeight: null,
  volumes: null,
  packages: null,
  measurement: null,
  freightValue: null,
  freightCurrency: null,
  freightTerms: null,
  freeTime: null,
  ncm: [],
  containerNumbers: [],
  containerQuantity: null,
  containerType: null,
  sealNumbers: [],
  onboardDate: null,
  eta: null,
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

describe("extractBl", () => {
  it("limpa textos, datas, embalagens, NCM e arrays do BL", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(BL_COMPLETO));

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl).toEqual(BL_LIMPO);
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

  it("usa o schema de extração do BL e envia o conteúdo preparado", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(BL_VAZIO));

    await extractBl(PREPARED_PDF);

    expect(mocks.outputObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: blExtractionSchema,
        name: "bl_extraction",
      }),
    );
    expect(opcoesDaChamada(0).output?.schema).toBe(blExtractionSchema);
    expect(opcoesDaChamada(0).messages?.[0]?.content?.[1]).toEqual(
      PREPARED_PDF.content[0],
    );
  });

  it("separa quantidade e tipo quando packages traz os dois", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        ...BL_VAZIO,
        packages: "10 CARTONS",
        volumes: null,
      }),
    );

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl.volumes).toBe("10");
    expect(resultado.bl.packages).toBe("CAIXAS");
  });

  it("traduz embalagem sem quantidade e mantém volumes existentes", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        ...BL_VAZIO,
        packages: "pallet",
        volumes: "5",
      }),
    );

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl.packages).toBe("PALETE");
    expect(resultado.bl.volumes).toBe("5");
  });

  it("mantém embalagem sem quantidade numérica", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        ...BL_VAZIO,
        packages: "CARTONS",
        volumes: null,
      }),
    );

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl.packages).toBe("CAIXAS");
    expect(resultado.bl.volumes).toBeNull();
  });

  it("mantém embalagem desconhecida em maiúsculas", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        ...BL_VAZIO,
        packages: "bulk",
        volumes: null,
      }),
    );

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl.packages).toBe("BULK");
    expect(resultado.bl.volumes).toBeNull();
  });

  it("preserva textos que parecem data sem aplicar uppercase", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        ...BL_VAZIO,
        freeTime: " 01/10/2026 ",
        onboardDate: " 2026-10-01 ",
        eta: " 02/11/2026 10:00 ",
      }),
    );

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl.freeTime).toBe("01/10/2026");
    expect(resultado.bl.onboardDate).toBe("2026-10-01");
    expect(resultado.bl.eta).toBe("02/11/2026 10:00");
  });

  it("trata arrays ausentes como vazios", async () => {
    mocks.generateText.mockResolvedValue(
      resultadoComSucesso({
        ...BL_VAZIO,
        ncm: undefined as unknown as string[],
        containerNumbers: undefined as unknown as string[],
        sealNumbers: undefined as unknown as string[],
      }),
    );

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl.ncm).toEqual([]);
    expect(resultado.bl.containerNumbers).toEqual([]);
    expect(resultado.bl.sealNumbers).toEqual([]);
  });

  it("normaliza campos ausentes para null e arrays vazios", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(BL_VAZIO));

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl).toEqual(BL_VAZIO);
  });

  it("rejeita quando a IA não retorna dados do BL", async () => {
    mocks.generateText.mockResolvedValue(resultadoComSucesso(null));

    await expect(extractBl(PREPARED_PDF)).rejects.toThrow(
      "A IA não retornou dados do BL",
    );
  });

  it("refaz com mistral-ocr quando o PDF falha no engine native", async () => {
    const erro = new Error("failed to parse PDF");
    mocks.generateText
      .mockRejectedValueOnce(erro)
      .mockResolvedValueOnce(resultadoComSucesso(BL_VAZIO));
    mocks.shouldFallbackPdfEngine.mockReturnValue(true);

    const resultado = await extractBl(PREPARED_PDF);

    expect(resultado.bl).toEqual(BL_VAZIO);
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

    await expect(extractBl(PREPARED_IMAGE)).rejects.toBe(erro);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.shouldFallbackPdfEngine).not.toHaveBeenCalled();
  });
});
