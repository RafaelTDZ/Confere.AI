/** SKU normalizado: maiusculas, sem espacos nas bordas. */
export function normalizeSku(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0) {
    throw new Error("SKU nao pode ser vazio");
  }
  if (normalized.length > 64) {
    throw new Error("SKU excede 64 caracteres");
  }
  return normalized;
}

const NCM_REGEX = /^\d{8}$/;

/** Valida NCM (8 digitos numericos). Aceita formatos com ponto/traco. */
export function normalizeNcm(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!NCM_REGEX.test(digits)) {
    throw new Error(`NCM invalido: ${value} (esperados 8 digitos)`);
  }
  return digits;
}

export function isValidNcm(value: string): boolean {
  try {
    normalizeNcm(value);
    return true;
  } catch {
    return false;
  }
}
