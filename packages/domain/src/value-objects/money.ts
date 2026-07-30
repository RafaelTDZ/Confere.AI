export interface Money {
  amount: number;
  currency: string;
}

export function money(amount: number, currency: string): Money {
  if (!Number.isFinite(amount)) {
    throw new Error("Valor monetario invalido");
  }
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Moeda invalida: ${currency}`);
  }
  return { amount: Math.round(amount * 100) / 100, currency: code };
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

/** Tolerancia relativa para comparacao de valores (default 1%). */
export function moneyEquals(a: Money, b: Money, tolerance = 0.01): boolean {
  if (!sameCurrency(a, b)) return false;
  const base = Math.max(Math.abs(a.amount), Math.abs(b.amount));
  if (base === 0) return true;
  return Math.abs(a.amount - b.amount) / base <= tolerance;
}

export interface Quantity {
  value: number;
  unit: string | null;
}

/** Tolerancia relativa para quantidades/pesos (default 0.5%). */
export function quantityEquals(a: number, b: number, tolerance = 0.005): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return a === b;
  return Math.abs(a - b) / base <= tolerance;
}
