export function normalizeNcmCode(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function formatNcmCode(code: string): string {
  const digits = normalizeNcmCode(code);
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
  }
  return digits;
}

export function formatNcmInput(value: string): string {
  const digits = normalizeNcmCode(value).slice(0, 10);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
  }
  return digits;
}
