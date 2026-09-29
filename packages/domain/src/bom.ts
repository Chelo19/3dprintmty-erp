import Decimal from "decimal.js";
import { AppError } from "@3dprintmty/shared";
import { mulQty, QTY_SCALE, roundDiv } from "./quantity";

export interface BomLine {
  componentId: string;
  /** Cantidad por unidad del padre, en la unidad de almacén del componente. */
  quantity: bigint;
  /** Porcentaje de merma con escala de cantidad: 5 % → 50000n. */
  scrapPct: bigint;
}

export type BomLookup = (productId: string) => readonly BomLine[] | undefined;

const MAX_DEPTH = 12;

export function lineRequirement(parentQty: bigint, line: BomLine): bigint {
  const base = mulQty(parentQty, line.quantity);
  if (line.scrapPct === 0n) return base;
  return base + roundDiv(mulQty(base, line.scrapPct), 100n);
}

/** Requerimiento directo (un nivel) para fabricar `qty` del producto. */
export function directRequirements(productId: string, qty: bigint, lookup: BomLookup): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const line of lookup(productId) ?? []) {
    result.set(line.componentId, (result.get(line.componentId) ?? 0n) + lineRequirement(qty, line));
  }
  return result;
}

/** Explosión multinivel: solo materiales hoja (sin BOM propio). */
export function explodeToLeaves(productId: string, qty: bigint, lookup: BomLookup): Map<string, bigint> {
  const leaves = new Map<string, bigint>();
  const walk = (current: string, amount: bigint, depth: number, path: Set<string>) => {
    if (depth > MAX_DEPTH) throw new AppError("bom_too_deep", "El BOM tiene demasiados niveles.");
    const lines = lookup(current);
    if (!lines?.length) {
      if (current !== productId) leaves.set(current, (leaves.get(current) ?? 0n) + amount);
      return;
    }
    for (const line of lines) {
      if (path.has(line.componentId)) {
        throw new AppError("bom_cycle", "El BOM se contiene a sí mismo.");
      }
      const next = new Set(path).add(line.componentId);
      walk(line.componentId, lineRequirement(amount, line), depth + 1, next);
    }
  };
  walk(productId, qty, 0, new Set([productId]));
  return leaves;
}

/** ¿Guardar estos componentes para `parentId` crearía un ciclo? */
export function createsBomCycle(parentId: string, componentIds: readonly string[], lookup: BomLookup): boolean {
  const stack = [...componentIds];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === parentId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const line of lookup(current) ?? []) stack.push(line.componentId);
  }
  return false;
}

/** Costo por unidad de almacén en centavos. El costo del catálogo es por unidad de compra (MXN/kg). */
export function stockUnitCostMinor(costMinor: bigint | null, uomFactor: string): Decimal {
  if (costMinor === null) return new Decimal(0);
  const factor = new Decimal(uomFactor);
  if (factor.lte(0)) throw new AppError("invalid_uom_factor", "El factor de conversión debe ser mayor a cero.");
  return new Decimal(costMinor.toString()).div(factor);
}

/** Costo de material por una unidad del producto, con rollup multinivel. */
export function rollupUnitCostMinor(
  productId: string,
  lookup: BomLookup,
  leafCost: (productId: string) => Decimal,
): Decimal {
  const memo = new Map<string, Decimal>();
  const walk = (current: string, path: Set<string>, depth: number): Decimal => {
    const cached = memo.get(current);
    if (cached) return cached;
    if (depth > MAX_DEPTH) throw new AppError("bom_too_deep", "El BOM tiene demasiados niveles.");
    const lines = lookup(current);
    if (!lines?.length) return leafCost(current);
    let total = new Decimal(0);
    for (const line of lines) {
      if (path.has(line.componentId)) throw new AppError("bom_cycle", "El BOM se contiene a sí mismo.");
      const perParent = new Decimal(lineRequirement(QTY_SCALE, line).toString()).div(QTY_SCALE.toString());
      total = total.add(perParent.mul(walk(line.componentId, new Set(path).add(line.componentId), depth + 1)));
    }
    memo.set(current, total);
    return total;
  };
  return walk(productId, new Set([productId]), 0);
}

/** Centavos por `qty` (escala de cantidad) a un costo unitario, redondeo a centavo. */
export function extendCostMinor(qty: bigint, unitCostMinor: Decimal): bigint {
  const value = new Decimal(qty.toString()).div(QTY_SCALE.toString()).mul(unitCostMinor);
  return BigInt(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}
