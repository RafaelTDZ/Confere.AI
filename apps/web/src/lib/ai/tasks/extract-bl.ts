import "server-only";

import { generateText, Output } from "ai";
import type { PreparedDocument } from "@/lib/ai/document-content";
import {
  getDocumentLanguageModel,
  shouldFallbackPdfEngine,
  type PdfEngine,
} from "@/lib/ai/tasks/document-model";
import { blExtractionSchema, type BlExtraction } from "@/lib/ai/schemas";
import {
  applyMarkdownFallbacks,
  normalizeBlExtraction,
} from "@/lib/ai/bl-normalize";
import { runAiTask } from "@/lib/ai/task-timeout";
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

function cleanBlExtraction(bl: BlExtraction): BlExtraction {
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
    masterBlNumber: trimOrNull(bl.masterBlNumber)?.replace(/\s+/g, "") ?? null,
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

async function extractOnce(
  prepared: PreparedDocument,
  pdfEngine: PdfEngine,
  abortSignal: AbortSignal,
) {
  return generateText({
    abortSignal,
    model: getDocumentLanguageModel({
      provider: prepared.provider,
      modelId: prepared.modelId,
      isPdf: prepared.isPdf,
      pdfEngine,
    }),
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
              "Leia todas as páginas do PDF, não só a primeira. O rider/anexo costuma trazer volumes, NCM, OFT/THD e free time.",
              "Não extraia nem infira número de Invoice a partir do BL.",
              "Campos obrigatórios no schema (use null quando não encontrar; arrays vazios se não houver itens):",
              "1) number — número do BL / Bill of Lading / AWB / conhecimento de embarque",
              "2) masterBlNumber — procure MASTER B/L, MBL NO., OCEAN B/L e B/L MASTER (BL da consolidação emitido pelo armador). Quando o BL do documento for do agente de carga (forwarder/NVOCC) e o documento trouxer o BL master, devolva apenas esse número (maiúsculas, sem espaços); se não houver, use null. Nunca repita o número do BL do documento.",
              "3) carrier — armador oceânico (vessel operator), NÃO o forwarder que emitiu o BL. Se o emitente for LX Pantos/YQN/DHL etc., use o armador identificável pelo navio (CMA CGM, MSC, MAERSK, EVERGREEN, COSCO, OOCL, HAPAG, HMM, ONE).",
              "4) shipper — shipper / exportador (texto; não estruture CNPJ nem endereço)",
              "5) consignee — consignatário (texto completo como aparece no BL)",
              "6) consigneeDetails — estruture o bloco Consignee em name, cnpj e address { street, number, complement, postalCode, city, state, country, other }; use null nos campos ausentes",
              "7) notifyParty — notify party (texto completo como aparece no BL)",
              "8) notifyPartyDetails — estruture o bloco Notify Party em name, cnpj e address { street, number, complement, postalCode, city, state, country, other }; use null nos campos ausentes",
              "9) polCity, polCountry — porto de origem (cidade e país)",
              "10) podCity, podCountry — porto de destino (cidade e país)",
              "11) vessel, voyage — navio e viagem",
              "12) descriptionOfGoods — descrição da mercadoria, sem o boilerplate SHIPPER'S LOAD AND COUNT / SAID TO CONTAIN",
              "13) grossWeight — peso bruto total em KGS; extraia o número COMO APARECE no documento (vírgula/ponto); a normalização converte",
              "14) volumes — quantidade TOTAL de volumes/cartons, como aparece (ex.: 2,664); a normalização remove o separador",
              "15) packages — tipo de embalagem, sem o número; se o documento estiver em inglês, traduza para português (CARTONS → CAIXAS, PALLETS → PALETES, DRUMS → TAMBORES, etc.)",
              "16) measurement — cubagem em CBM, como aparece (ex.: 136.000)",
              "17) freightValue, freightCurrency, freightTerms, freeTime — procure OFT/ocean freight e free time inclusive no rider; ex.: \"OFT:USD 8400\" → 8400 / USD; \"FREE TIME: 21 DAYS\" → 21 DIAS; \"FREIGHT PREPAID\" → FREIGHT PREPAID",
              "18) ncm[] — códigos HS/NCM completos como aparecem (dígitos e pontuação do código; não truncar; não inventar)",
              "19) containerNumbers[], containerQuantity (ex.: 2), containerType (ex.: 40 HC), sealNumbers[] — em \"2X40 HC\", separe a quantidade (2) do tipo (40 HC)",
              "20) onboardDate, eta — SEMPRE no padrão DD/MM/AAAA (converta OCT/01/2026 → 01/10/2026; 2026-10-01 → 01/10/2026)",
              "Texto em maiúsculas quando fizer sentido (nomes, portos, carrier, navio).",
              "Não invente valores; prefira null a chutes.",
            ].join("\n"),
          },
          ...prepared.content,
        ],
      },
    ],
  });
}

export async function extractBl(prepared: PreparedDocument): Promise<{
  bl: BlExtraction;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  usage: AiTaskUsage;
}> {
  const started = Date.now();

  let result;
  try {
    result = await runAiTask("extract_bl", (signal) =>
      extractOnce(prepared, "native", signal),
    );
  } catch (error) {
    if (
      prepared.isPdf &&
      prepared.provider === "openrouter" &&
      shouldFallbackPdfEngine(error)
    ) {
      result = await runAiTask("extract_bl:mistral-ocr", (signal) =>
        extractOnce(prepared, "mistral-ocr", signal),
      );
    } else {
      throw error;
    }
  }

  const raw = result.output;
  if (!raw) {
    throw new Error("A IA não retornou dados do BL");
  }

  const normalized = normalizeBlExtraction(cleanBlExtraction(raw));
  const markdown = prepared.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
  const bl = markdown
    ? applyMarkdownFallbacks(normalized, markdown)
    : normalized;
  const usage = extractAiTaskUsage(result, Date.now() - started);

  return {
    bl,
    model: prepared.modelId,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    usage,
  };
}
