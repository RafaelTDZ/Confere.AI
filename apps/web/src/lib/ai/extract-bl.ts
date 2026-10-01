import { generateText, Output } from "ai";
import type { AnalyzeFileInput } from "@/lib/ai/classify";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/document-model";
import { getOpenRouterModel } from "@/lib/ai/model-config";
import { blExtractionSchema, type BlExtraction } from "@/lib/ai/schemas";
import { extractAiTaskUsage, type AiTaskUsage } from "@/lib/ai/usage";

const PACKAGE_TRANSLATIONS: Record<string, string> = {
  CARTONS: "CAIXAS",
  CARTON: "CAIXA",
  PACKAGES: "VOLUMES",
  PACKAGE: "VOLUME",
  PALLETS: "PALETES",
  PALLET: "PALETE",
  DRUMS: "TAMBORES",
  DRUM: "TAMBOR",
  BAGS: "SACOS",
  BAG: "SACO",
  BOXES: "CAIXAS",
  BOX: "CAIXA",
  CRATES: "CAIXOTES",
  CRATE: "CAIXOTE",
  REELS: "BOBINAS",
  REEL: "BOBINA",
  PIECES: "PEÇAS",
  PIECE: "PEÇA",
  UNITS: "UNIDADES",
  UNIT: "UNIDADE",
  CASES: "CAIXAS",
  CASE: "CAIXA",
};

const DATE_LIKE_RE =
  /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;

function trimOrNull(value: string | null | undefined): string | null {
  const next = value?.trim() ?? "";
  return next.length > 0 ? next : null;
}

function looksLikeDate(value: string): boolean {
  return DATE_LIKE_RE.test(value.trim());
}

function uppercaseText(value: string | null | undefined): string | null {
  const next = trimOrNull(value);
  if (!next) return null;
  if (looksLikeDate(next)) return next;
  return next.toUpperCase();
}

function cleanNcmCode(code: string): string | null {
  const cleaned = code.replace(/[^\d.]/g, "").replace(/^\.+|\.+$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function cleanStringArray(
  values: string[] | null | undefined,
  transform: (value: string) => string | null,
): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => transform(value))
    .filter((value): value is string => Boolean(value));
}

export function cleanBlExtraction(bl: BlExtraction): BlExtraction {
  let packages = trimOrNull(bl.packages);
  let volumes = trimOrNull(bl.volumes);

  if (packages && !volumes) {
    const match = packages.match(/^(\d+)\s+(.+)$/);
    const quantity = match?.[1];
    const kind = match?.[2]?.trim();
    if (quantity && kind) {
      volumes = quantity;
      packages = kind;
    }
  }

  if (packages) {
    const upper = packages.toUpperCase();
    packages = PACKAGE_TRANSLATIONS[upper] ?? upper;
  }

  return {
    number: uppercaseText(bl.number),
    carrier: uppercaseText(bl.carrier),
    shipper: uppercaseText(bl.shipper),
    consignee: uppercaseText(bl.consignee),
    consigneeDetails: {
      name: uppercaseText(bl.consigneeDetails.name),
      cnpj: trimOrNull(bl.consigneeDetails.cnpj),
      address: bl.consigneeDetails.address,
    },
    notifyParty: uppercaseText(bl.notifyParty),
    notifyPartyDetails: {
      name: uppercaseText(bl.notifyPartyDetails.name),
      cnpj: trimOrNull(bl.notifyPartyDetails.cnpj),
      address: bl.notifyPartyDetails.address,
    },
    polCity: uppercaseText(bl.polCity),
    polCountry: uppercaseText(bl.polCountry),
    podCity: uppercaseText(bl.podCity),
    podCountry: uppercaseText(bl.podCountry),
    vessel: uppercaseText(bl.vessel),
    voyage: uppercaseText(bl.voyage),
    descriptionOfGoods: uppercaseText(bl.descriptionOfGoods),
    grossWeight: trimOrNull(bl.grossWeight),
    volumes,
    packages,
    measurement: trimOrNull(bl.measurement),
    freightValue: trimOrNull(bl.freightValue),
    freightCurrency: uppercaseText(bl.freightCurrency),
    freightTerms: uppercaseText(bl.freightTerms),
    freeTime: uppercaseText(bl.freeTime),
    ncm: cleanStringArray(bl.ncm, cleanNcmCode),
    containerNumbers: cleanStringArray(bl.containerNumbers, uppercaseText),
    containerQuantity: trimOrNull(bl.containerQuantity),
    containerType: uppercaseText(bl.containerType),
    sealNumbers: cleanStringArray(bl.sealNumbers, uppercaseText),
    onboardDate: trimOrNull(bl.onboardDate),
    eta: trimOrNull(bl.eta),
  };
}

async function extractOnce(file: AnalyzeFileInput, pdfEngine: PdfEngine) {
  const isPdf = file.mediaType === "application/pdf";
  return generateText({
    model: getDocumentLanguageModel({ isPdf, pdfEngine }),
    output: Output.object({
      schema: blExtractionSchema,
      name: "bl_extraction",
      description: "Campos estruturados do Bill of Lading",
    }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Extraia os dados do Bill of Lading (BL/AWB / conhecimento de embarque) anexado.",
              "Leia todas as páginas do PDF, não só a primeira.",
              "Não extraia nem infira número de Invoice a partir do BL.",
              "Campos obrigatórios no schema (use null quando não encontrar; arrays vazios se não houver itens):",
              "1) number — número do BL / Bill of Lading / AWB / conhecimento de embarque",
              "2) carrier — armador / transportadora",
              "3) shipper — shipper / exportador (texto; não estruture CNPJ nem endereço)",
              "4) consignee — consignatário (texto completo como aparece no BL)",
              "5) consigneeDetails — estruture o bloco Consignee em name, cnpj e address { street, number, complement, postalCode, city, state, country, other }; use null nos campos ausentes",
              "6) notifyParty — notify party (texto completo como aparece no BL)",
              "7) notifyPartyDetails — estruture o bloco Notify Party em name, cnpj e address { street, number, complement, postalCode, city, state, country, other }; use null nos campos ausentes",
              "8) polCity, polCountry — porto de origem (cidade e país)",
              "9) podCity, podCountry — porto de destino (cidade e país)",
              "10) vessel, voyage — navio e viagem",
              "11) descriptionOfGoods — descrição da mercadoria",
              "12) grossWeight — peso bruto (números; preserve o decimal do documento, vírgula ou ponto)",
              "13) volumes — quantidade de volumes",
              "14) packages — tipo de embalagem; se o documento estiver em inglês, traduza para português (CAIXAS, PALETES, SACOS, TAMBORES, BOBINAS, etc.)",
              "15) measurement — cubagem (números; preserve o decimal do documento)",
              "16) freightValue, freightCurrency, freightTerms, freeTime",
              "17) ncm[] — códigos HS/NCM completos como aparecem (dígitos e pontuação do código; não truncar; não inventar)",
              "18) containerNumbers[], containerQuantity, containerType, sealNumbers[]",
              "19) onboardDate, eta — datas como no documento",
              "Texto em maiúsculas quando fizer sentido (nomes, portos, carrier, navio).",
              "Não invente valores; prefira null a chutes.",
            ].join("\n"),
          },
          {
            type: "file",
            mediaType: file.mediaType,
            filename: file.filename,
            data: file.bytes,
          },
        ],
      },
    ],
  });
}

export async function extractBl(file: AnalyzeFileInput): Promise<{
  bl: BlExtraction;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  usage: AiTaskUsage;
}> {
  const modelId = getOpenRouterModel();
  const isPdf = file.mediaType === "application/pdf";
  const started = Date.now();

  let result;
  try {
    result = await extractOnce(file, "native");
  } catch (error) {
    if (isPdf && shouldFallbackPdfEngine(error)) {
      result = await extractOnce(file, "mistral-ocr");
    } else {
      throw error;
    }
  }

  const raw = result.output;
  if (!raw) {
    throw new Error("A IA não retornou dados do BL");
  }

  const bl = cleanBlExtraction(raw);
  const usage = extractAiTaskUsage(result, Date.now() - started);

  return {
    bl,
    model: modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
