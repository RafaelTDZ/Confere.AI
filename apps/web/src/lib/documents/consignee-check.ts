import {
  normalizeCnpjDigits,
  parsePartyAddress,
  type PartyAddress,
} from "@/lib/documents/parties-shared";
import { normalizeUf } from "@/lib/documents/uf-shared";

export type ConsigneeSnapshot = {
  name: string | null;
  cnpj: string | null;
  address: PartyAddress;
};

export type ConsigneeDefault = ConsigneeSnapshot & { id: string };

export type ConsigneeDivergence = {
  field: string;
  label: string;
  documentValue: string | null;
  defaultConsigneeValue: string | null;
};

type ExtractedParty = {
  name?: string | null;
  cnpj?: string | null;
  address?: unknown;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

/** Texto comparável: apara, colapsa espaços internos e sobe a caixa. */
function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().replace(/\s+/g, " ").toUpperCase();
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeCnpj(value: string | null | undefined): string | null {
  const digits = normalizeCnpjDigits(value);
  return digits.length > 0 ? digits : null;
}

/** CEP/código postal: só alfanuméricos maiúsculos (sem espaço, hífen ou pontuação). */
function normalizePostalCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** "BRAZIL" e "BRASIL" são o mesmo país. */
function normalizeCountry(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized === "BRAZIL" ? "BRASIL" : normalized;
}

type CompareField = {
  field: string;
  label: string;
  normalize: (value: string | null | undefined) => string | null;
  read: (snapshot: ConsigneeSnapshot) => string | null;
};

const COMPARE_FIELDS: CompareField[] = [
  {
    field: "name",
    label: "Nome",
    normalize: normalizeText,
    read: (snapshot) => snapshot.name,
  },
  {
    field: "cnpj",
    label: "CNPJ",
    normalize: normalizeCnpj,
    read: (snapshot) => snapshot.cnpj,
  },
  {
    field: "street",
    label: "Logradouro",
    normalize: normalizeText,
    read: (snapshot) => snapshot.address.street,
  },
  {
    field: "number",
    label: "Número",
    normalize: normalizeText,
    read: (snapshot) => snapshot.address.number,
  },
  {
    field: "complement",
    label: "Complemento",
    normalize: normalizeText,
    read: (snapshot) => snapshot.address.complement,
  },
  {
    field: "postalCode",
    label: "CEP",
    normalize: normalizePostalCode,
    read: (snapshot) => snapshot.address.postalCode,
  },
  {
    field: "city",
    label: "Cidade",
    normalize: normalizeText,
    read: (snapshot) => snapshot.address.city,
  },
  {
    field: "state",
    label: "UF/Estado",
    // "Santa Catarina" e "SC" são o mesmo estado, não uma divergência.
    normalize: (value) => normalizeUf(value) ?? normalizeText(value),
    read: (snapshot) => snapshot.address.state,
  },
  {
    field: "country",
    label: "País",
    normalize: normalizeCountry,
    read: (snapshot) => snapshot.address.country,
  },
  {
    field: "other",
    label: "Bairro/Outros",
    normalize: normalizeText,
    read: (snapshot) => snapshot.address.other,
  },
];

function hasAddressValue(address: PartyAddress): boolean {
  return Object.values(address).some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

/**
 * Normaliza a parte extraída do documento (invoice.importer ou consignee do BL).
 * Devolve `null` quando não há nome, CNPJ nem endereço — nada a comparar.
 */
export function snapshotFromExtractedParty(
  party: ExtractedParty | null | undefined,
): ConsigneeSnapshot | null {
  if (!party) return null;

  const name = trimmedOrNull(party.name);
  const cnpj = trimmedOrNull(party.cnpj);
  const address = parsePartyAddress(party.address);

  if (!name && !cnpj && !hasAddressValue(address)) return null;

  return {
    name,
    cnpj,
    address,
  };
}

/**
 * Compara o consignee do documento com o consignee padrão do tenant.
 *
 * Só gera divergência quando o documento traz valor: campo vazio no documento
 * significa "não informado", não "diferente". Os valores são normalizados para
 * caixa/espaços, CNPJ vira dígitos, CEP vira alfanumérico e BRAZIL ≡ BRASIL.
 */
export function compareConsignee(
  document: ConsigneeSnapshot | null,
  defaultConsignee: ConsigneeSnapshot | null,
): ConsigneeDivergence[] {
  if (!document || !defaultConsignee) return [];

  const divergences: ConsigneeDivergence[] = [];

  for (const spec of COMPARE_FIELDS) {
    const documentValue = spec.normalize(spec.read(document));
    if (documentValue === null) continue;

    const defaultConsigneeValue = spec.normalize(spec.read(defaultConsignee));
    if (defaultConsigneeValue === documentValue) continue;

    divergences.push({
      field: spec.field,
      label: spec.label,
      documentValue,
      defaultConsigneeValue,
    });
  }

  return divergences;
}

/** `undefined` = valor inválido (o item deve ser descartado). */
function stringOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : undefined;
}

/** Lê o JSON persistido em `imports.consignee_divergences`. */
export function parseConsigneeDivergences(
  value: unknown,
): ConsigneeDivergence[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: ConsigneeDivergence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.field !== "string" || typeof row.label !== "string") {
      continue;
    }

    const documentValue = stringOrNull(row.documentValue);
    const defaultConsigneeValue = stringOrNull(row.defaultConsigneeValue);
    if (documentValue === undefined || defaultConsigneeValue === undefined) {
      continue;
    }

    parsed.push({
      field: row.field,
      label: row.label,
      documentValue,
      defaultConsigneeValue,
    });
  }

  return parsed;
}
