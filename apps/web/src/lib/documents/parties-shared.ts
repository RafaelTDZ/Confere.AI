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

export function parsePartyAddress(value: unknown): PartyAddress {
  if (typeof value === "string") {
    return { ...EMPTY_PARTY_ADDRESS, other: trimmedOrNull(value) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_PARTY_ADDRESS };
  }
  const row = value as Record<string, unknown>;
  return {
    street: trimmedOrNull(row.street),
    number: trimmedOrNull(row.number ?? row.street_number),
    complement: trimmedOrNull(row.complement),
    postalCode: trimmedOrNull(row.postalCode ?? row.postal_code),
    city: trimmedOrNull(row.city),
    state: trimmedOrNull(row.state),
    country: trimmedOrNull(row.country),
    other: trimmedOrNull(row.other ?? row.other_info),
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

export function formatAddressLine(address: PartyAddress | null | undefined): string {
  if (!address) return "";
  const streetLine = [address.street, address.number].filter(Boolean).join(", ");
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
