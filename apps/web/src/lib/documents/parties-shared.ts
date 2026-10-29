import { normalizeUf } from "@/lib/documents/uf-shared";

export type PartyRole = "consignee" | "notify";

export type PartyAddress = {
  street: string | null;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  other: string | null;
};

export type PendingParty = {
  roles: PartyRole[];
  name: string | null;
  cnpj: string | null;
  address: PartyAddress;
};

export const EMPTY_PARTY_ADDRESS: PartyAddress = {
  street: null,
  number: null,
  complement: null,
  postalCode: null,
  city: null,
  state: null,
  country: null,
  other: null,
};

const ROLE_LABELS: Record<PartyRole, string> = {
  consignee: "Consignee (importador)",
  notify: "Notify (adquirente)",
};

export function partyRolesLabel(roles: PartyRole[]): string {
  const unique = [...new Set(roles)];
  return unique.map((role) => ROLE_LABELS[role]).join(" e ");
}

export function normalizeCnpjDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(0, 14);
}

export function formatCnpj(digits: string): string {
  const d = normalizeCnpjDigits(digits);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatCnpjInput(value: string): string {
  const d = normalizeCnpjDigits(value);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return formatCnpj(d);
}

export function isValidCnpjDigits(digits: string): boolean {
  return digits.length === 14;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STREET_LABELS = [
  "logradouro",
  "endereço",
  "endereco",
  "address",
  "street",
  "rua",
] as const;

const NUMBER_LABELS = [
  "número",
  "numero",
  "number",
  "nº",
  "n°",
  "no.",
] as const;

const COMPLEMENT_LABELS = [
  "complemento",
  "complement",
  "apartamento",
  "apto",
  "sala",
  "bloco",
  "andar",
] as const;

const POSTAL_LABELS = [
  "código postal",
  "codigo postal",
  "postal code",
  "zip code",
  "zip",
  "cep",
] as const;

const CITY_LABELS = ["município", "municipio", "cidade", "city"] as const;

const STATE_LABELS = [
  "província",
  "provincia",
  "province",
  "estado",
  "state",
  "uf",
] as const;

const COUNTRY_LABELS = ["país", "pais", "country"] as const;

const OTHER_LABELS = [
  "observação",
  "observacao",
  "referência",
  "referencia",
  "neighborhood",
  "district",
  "bairro",
  "distrito",
  "região",
  "regiao",
  "region",
  "obs",
] as const;

/**
 * Rótulos limpos mesmo sem separador. "Bairro" é o nome do próprio campo, então
 * "Bairro Glória" é rótulo repetido; já "Distrito Industrial" precisa ficar
 * intacto, por isso só ele entra aqui.
 */
const OTHER_LOOSE_LABELS = ["bairro"] as const;

/**
 * Remove rótulos que a IA às vezes repete no valor ("BAIRRO: ZONA INDUSTRIAL",
 * "CEP: 01310-100"). Só remove quando o rótulo é seguido de separador, para não
 * cortar valores legítimos como "Rua das Flores" ou "Sala 5". Com
 * `allowSpace`, o espaço também separa o rótulo do valor.
 */
function stripAddressLabels(
  value: string | null,
  labels: readonly string[],
  allowSpace = false,
): string | null {
  if (!value) return null;
  let next = value.trim();
  let changed = true;

  while (changed && next.length > 0) {
    changed = false;
    for (const label of labels) {
      const separator = allowSpace ? "[\\s:=\\-–—]+" : "\\s*[:=\\-–—]\\s*";
      const pattern = new RegExp(`^${escapeRegExp(label)}${separator}`, "i");
      const stripped = next.replace(pattern, "").trim();
      if (stripped !== next) {
        next = stripped;
        changed = true;
      }
    }
  }

  return next.length > 0 ? next : null;
}

export function parsePartyAddress(value: unknown): PartyAddress {
  if (typeof value === "string") {
    return {
      ...EMPTY_PARTY_ADDRESS,
      other: stripAddressLabels(
        stripAddressLabels(trimmedOrNull(value), OTHER_LOOSE_LABELS, true),
        OTHER_LABELS,
      ),
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_PARTY_ADDRESS };
  }
  const row = value as Record<string, unknown>;
  const state = stripAddressLabels(trimmedOrNull(row.state), STATE_LABELS);
  return {
    street: stripAddressLabels(trimmedOrNull(row.street), STREET_LABELS),
    number: stripAddressLabels(
      trimmedOrNull(row.number ?? row.street_number),
      NUMBER_LABELS,
    ),
    complement: stripAddressLabels(
      trimmedOrNull(row.complement),
      COMPLEMENT_LABELS,
    ),
    postalCode: stripAddressLabels(
      trimmedOrNull(row.postalCode ?? row.postal_code),
      POSTAL_LABELS,
    ),
    city: stripAddressLabels(trimmedOrNull(row.city), CITY_LABELS),
    state: normalizeUf(state) ?? state,
    country: stripAddressLabels(trimmedOrNull(row.country), COUNTRY_LABELS),
    other: stripAddressLabels(
      stripAddressLabels(
        trimmedOrNull(row.other ?? row.other_info),
        OTHER_LOOSE_LABELS,
        true,
      ),
      OTHER_LABELS,
    ),
  };
}

/** Normaliza um valor de party para o padrão do produto (maiúsculas). */
export function uppercasePartyText(value: string | null): string | null {
  if (!value) return null;
  const next = value.trim().replace(/\s+/g, " ").toUpperCase();
  return next.length > 0 ? next : null;
}

function trimTrailingSeparators(value: string | null): string | null {
  if (!value) return null;
  const next = value.replace(/[,;]+$/, "").trim();
  return next.length > 0 ? next : null;
}

export function uppercasePartyAddress(address: PartyAddress): PartyAddress {
  return {
    street: uppercasePartyText(address.street),
    number: uppercasePartyText(address.number),
    complement: uppercasePartyText(address.complement),
    postalCode: uppercasePartyText(address.postalCode),
    city: uppercasePartyText(address.city),
    state: uppercasePartyText(address.state),
    country: uppercasePartyText(address.country),
    other: trimTrailingSeparators(uppercasePartyText(address.other)),
  };
}

export function mergePartyAddress(
  current: PartyAddress,
  incoming: PartyAddress,
): PartyAddress {
  return {
    street: current.street || incoming.street,
    number: current.number || incoming.number,
    complement: current.complement || incoming.complement,
    postalCode: current.postalCode || incoming.postalCode,
    city: current.city || incoming.city,
    state: current.state || incoming.state,
    country: current.country || incoming.country,
    other: current.other || incoming.other,
  };
}

export function formatAddressLine(
  address: PartyAddress | null | undefined,
): string {
  if (!address) return "";
  const streetLine = [address.street, address.number]
    .filter(Boolean)
    .join(", ");
  return [
    streetLine,
    address.complement,
    address.postalCode,
    address.city,
    address.state,
    address.country,
    address.other,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatCepInput(value: string): string {
  const hasLetters = /[A-Za-z]/.test(value);
  if (hasLetters) return value.slice(0, 16);
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
