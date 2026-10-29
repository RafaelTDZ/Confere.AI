import { z } from "zod";

const documentTypeSchema = z.enum([
  "invoice",
  "packing_list",
  "bill_of_lading",
]);

export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentClassificationSchema = z.object({
  types: z
    .array(documentTypeSchema)
    .min(1)
    .describe(
      "Tipos de documento de importação presentes no arquivo (pode haver mais de um)",
    ),
  // Azure/OpenAI strict JSON schema exige toda key de properties em required.
  // Use nullable (não optional) para campos ausentes.
  notes: z
    .string()
    .nullable()
    .describe("Observação breve sobre a classificação, ou null"),
});

export type DocumentClassification = z.infer<
  typeof documentClassificationSchema
>;

const partyAddressSchema = z.object({
  street: z
    .string()
    .nullable()
    .describe("Logradouro / rua (apenas o nome, sem rótulo 'Rua:')"),
  number: z
    .string()
    .nullable()
    .describe("Número do endereço (apenas o número, sem rótulo)"),
  complement: z
    .string()
    .nullable()
    .describe("Complemento (sala, bloco, andar), sem rótulo 'Complemento:'"),
  postalCode: z
    .string()
    .nullable()
    .describe("CEP ou código postal (apenas o código, sem 'CEP:')"),
  city: z
    .string()
    .nullable()
    .describe("Cidade (apenas o nome, sem rótulo 'Cidade:')"),
  state: z
    .string()
    .nullable()
    .describe("Estado / UF / província (apenas a sigla/nome, sem rótulo)"),
  country: z
    .string()
    .nullable()
    .describe("País (apenas o nome, sem rótulo 'País:')"),
  other: z
    .string()
    .nullable()
    .describe(
      "Bairro, referência ou outras informações de endereço (apenas o valor, sem rótulo 'Bairro:')",
    ),
});

const partySchema = z.object({
  name: z.string().nullable().describe("Razão social ou nome"),
  cnpj: z.string().nullable().describe("CNPJ ou equivalente fiscal, se houver"),
  address: partyAddressSchema.describe("Endereço estruturado"),
});

export type InvoiceParty = z.infer<typeof partySchema>;

const blPartyDetailsSchema = z.object({
  name: z
    .string()
    .nullable()
    .describe("Razão social ou nome como aparece no BL"),
  cnpj: z
    .string()
    .nullable()
    .describe("CNPJ ou equivalente fiscal, se aparecer"),
  address: partyAddressSchema.describe("Endereço estruturado da empresa"),
});

const exporterSchema = z.object({
  name: z.string().nullable().describe("Nome do exportador / shipper"),
});

const invoiceProductSchema = z.object({
  code: z.string().nullable().describe("Código / referência / SKU do produto"),
  ncm: z.string().nullable().describe("NCM ou HS code"),
  description: z.string().nullable().describe("Descrição do produto"),
});

export const invoiceExtractionSchema = z.object({
  number: z
    .string()
    .nullable()
    .describe("Número da invoice / commercial invoice"),
  blNumber: z
    .string()
    .nullable()
    .describe("Número do BL / Bill of Lading / AWB se constar na invoice"),
  exporter: exporterSchema.describe("Dados do exportador (shipper)"),
  importer: partySchema.describe(
    "Importador / consignee (nome, CNPJ e endereço)",
  ),
  notify: partySchema.describe(
    "Adquirente / notify party (nome, CNPJ e endereço)",
  ),
  products: z
    .array(invoiceProductSchema)
    .describe("Linhas de produto da invoice"),
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

export const packingListExtractionSchema = z.object({
  invoiceNumber: z
    .string()
    .nullable()
    .describe(
      "Número da Invoice associado ao Packing List, se estiver indicado",
    ),
});

export type PackingListExtraction = z.infer<typeof packingListExtractionSchema>;

// Azure/OpenAI strict JSON: todas as keys em required via nullable, não optional.
// Arrays ficam sempre presentes (podem ser vazios).
export const blExtractionSchema = z.object({
  number: z
    .string()
    .nullable()
    .describe("Número do Bill of Lading / BL / AWB / conhecimento de embarque"),
  masterBlNumber: z
    .string()
    .nullable()
    .describe(
      "BL master / MBL / OCEAN B/L da consolidação, quando o BL do documento for do agente de carga",
    ),
  carrier: z.string().nullable().describe("Armador / transportadora / carrier"),
  shipper: z
    .string()
    .nullable()
    .describe("Shipper / exportador (texto como no BL)"),
  consignee: z
    .string()
    .nullable()
    .describe("Consignee / consignatário (texto como no BL)"),
  consigneeDetails: blPartyDetailsSchema.describe(
    "Dados estruturados da empresa consignatária, extraídos do bloco Consignee",
  ),
  notifyParty: z
    .string()
    .nullable()
    .describe("Notify party / notificadora (texto como no BL)"),
  notifyPartyDetails: blPartyDetailsSchema.describe(
    "Dados estruturados da empresa notify, extraídos do bloco Notify Party",
  ),
  polCity: z
    .string()
    .nullable()
    .describe("Cidade do porto de origem (POL / Port of Loading)"),
  polCountry: z.string().nullable().describe("País do porto de origem (POL)"),
  podCity: z
    .string()
    .nullable()
    .describe("Cidade do porto de destino (POD / Port of Discharge)"),
  podCountry: z.string().nullable().describe("País do porto de destino (POD)"),
  vessel: z.string().nullable().describe("Navio / vessel"),
  voyage: z.string().nullable().describe("Viagem / voyage"),
  descriptionOfGoods: z
    .string()
    .nullable()
    .describe("Descrição da mercadoria / description of goods"),
  grossWeight: z
    .string()
    .nullable()
    .describe(
      "Peso bruto (números; preserve o decimal do documento, vírgula ou ponto)",
    ),
  volumes: z
    .string()
    .nullable()
    .describe("Quantidade de volumes / packages quantity"),
  packages: z
    .string()
    .nullable()
    .describe(
      "Tipo de embalagem (preferir português: CAIXAS, PALETES, SACOS, etc.)",
    ),
  measurement: z
    .string()
    .nullable()
    .describe(
      "Cubagem / measurement (números; preserve o decimal do documento)",
    ),
  freightValue: z
    .string()
    .nullable()
    .describe("Valor do frete (números; preserve o decimal do documento)"),
  freightCurrency: z
    .string()
    .nullable()
    .describe("Moeda do frete (USD, EUR, etc.)"),
  freightTerms: z
    .string()
    .nullable()
    .describe("Termos de frete (PREPAID, COLLECT, etc.)"),
  freeTime: z
    .string()
    .nullable()
    .describe("Free time / prazo livre de demurrage ou detention"),
  ncm: z
    .array(z.string())
    .describe(
      "Códigos HS/NCM completos como no documento (não truncar; só o código)",
    ),
  containerNumbers: z.array(z.string()).describe("Números dos containers"),
  containerQuantity: z.string().nullable().describe("Quantidade de containers"),
  containerType: z
    .string()
    .nullable()
    .describe("Tipo de container (20DRY, 40HC, etc.)"),
  sealNumbers: z.array(z.string()).describe("Números dos lacres / seals"),
  onboardDate: z
    .string()
    .nullable()
    .describe(
      "Data de embarque / shipped on board (ETS), no padrão DD/MM/AAAA",
    ),
  eta: z
    .string()
    .nullable()
    .describe("ETA / data estimada de chegada, no padrão DD/MM/AAAA"),
});

export type BlExtraction = z.infer<typeof blExtractionSchema>;
