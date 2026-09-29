import { AppError } from "@3dprintmty/shared";

/** Cantidades con 4 decimales como bigint: 1.5 → 15000n. Igual que numeric(14, 4) en Postgres. */
export const QTY_SCALE = 10_000n;

export function parseQty(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d{1,4})?$/.test(unsigned)) {
    throw new AppError("invalid_quantity", "La cantidad no es válida.");
  }
  const [whole, frac = ""] = unsigned.split(".");
  const scaled = BigInt(whole ?? "0") * QTY_SCALE + BigInt(`${frac}0000`.slice(0, 4));
  return negative ? -scaled : scaled;
}

export function formatQty(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

/** Lee lo que devuelve Postgres para numeric(14, 4) ("500.0000"). */
export function qtyFromDb(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return parseQty(String(value));
}

export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new AppError("invalid_quantity", "División entre cero.");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

export function mulQty(a: bigint, b: bigint): bigint {
  return roundDiv(a * b, QTY_SCALE);
}

export function minQty(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxQty(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
