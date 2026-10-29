/** Normalização e validação de números de BL/container. */

const CONTAINER_RE = /^[A-Z]{4}\d{6}\d$/;

/** Tabela ISO 6346: letras pulam os múltiplos de 11. */
const LETTER_VALUES: Record<string, number> = (() => {
  const values: Record<string, number> = {};
  let value = 10;
  for (let code = 65; code <= 90; code += 1) {
    if (value % 11 === 0) value += 1;
    values[String.fromCharCode(code)] = value;
    value += 1;
  }
  return values;
})();

const CONTAINER_WEIGHTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

/** Dígito verificador ISO 6346 (0-9) ou null se o formato for inválido. */
export function containerCheckDigit(value: string): number | null {
  const normalized = normalizeTrackingNumber(value);
  if (!normalized || !CONTAINER_RE.test(normalized)) return null;

  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = normalized.charAt(index);
    const numeric = /\d/.test(char)
      ? Number(char)
      : LETTER_VALUES[char];
    if (numeric === undefined) return null;
    sum += numeric * (CONTAINER_WEIGHTS[index] ?? 0);
  }

  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

/** Container com formato e dígito verificador válidos. */
export function isValidContainerNumber(value: string): boolean {
  const normalized = normalizeTrackingNumber(value);
  if (!normalized || !CONTAINER_RE.test(normalized)) return false;
  return containerCheckDigit(normalized) === Number(normalized.charAt(10));
}

/**
 * Normaliza BL/container: remove espaços, hífens e pontuação, mantém
 * letras/números e devolve em maiúsculas. Retorna null quando vazio.
 */
export function normalizeTrackingNumber(
  value: string | null | undefined,
): string | null {
  const next = (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
  return next.length > 0 ? next : null;
}

/** BL costuma aceitar letras/números; só descarta valores absurdos. */
export function normalizeBlNumber(value: string | null | undefined): string | null {
  const next = normalizeTrackingNumber(value);
  if (!next) return null;
  if (next.length < 4 || next.length > 30) return null;
  return next;
}

/** Deduplica e mantém apenas containers válidos (ISO 6346). */
export function validContainerNumbers(
  values: ReadonlyArray<string | null | undefined>,
  limit = 8,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeTrackingNumber(value);
    if (!normalized) continue;
    if (!isValidContainerNumber(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}
