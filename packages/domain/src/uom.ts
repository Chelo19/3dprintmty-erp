import Decimal from "decimal.js";
import { AppError } from "@3dprintmty/shared";
import { Money } from "./money";

export const STOCK_UOMS = ["G", "KG", "EA", "ML", "L", "M"] as const;
export type StockUom = (typeof STOCK_UOMS)[number];

export const UOM_LABELS: Record<StockUom, string> = {
  EA: "Pieza (pza)",
  G: "Gramo (g)",
  KG: "Kilogramo (kg)",
  ML: "Mililitro (ml)",
  L: "Litro (L)",
  M: "Metro (m)",
};

const UOM_SHORT: Record<StockUom, string> = { EA: "pza", G: "g", KG: "kg", ML: "ml", L: "L", M: "m" };

/** Abreviatura para cotizaciones, pedidos y tablas. */
export function uomShort(uom: string): string {
  return UOM_SHORT[uom as StockUom] ?? uom.toLowerCase();
}

const TO_GRAMS: Record<StockUom, Decimal | null> = {
  G: new Decimal(1),
  KG: new Decimal(1000),
  EA: null,
  ML: null,
  L: null,
  M: null,
};

export function convertQuantity(
  quantity: string,
  from: StockUom,
  to: StockUom,
): string {
  if (from === to) return new Decimal(quantity).toFixed();
  const fromGrams = TO_GRAMS[from];
  const toGrams = TO_GRAMS[to];
  if (!fromGrams || !toGrams) {
    throw new AppError(
      "uom_incompatible",
      "Esas unidades no se pueden convertir entre sí.",
    );
  }
  return new Decimal(quantity).mul(fromGrams).div(toGrams).toFixed();
}

/**
 * Valúa existencia en unidad de almacén contra el costo de la unidad de compra.
 * El factor es conversión de unidad (1000 G = 1 KG), no el tamaño del rollo.
 */
export function valueStock(input: {
  onHand: string;
  stockUom: StockUom;
  cost: Money;
  purchaseUom: StockUom;
  factor: string;
}): Money {
  if (input.stockUom !== input.purchaseUom && (input.stockUom === "EA" || input.purchaseUom === "EA")) {
    throw new AppError(
      "uom_incompatible",
      "Las piezas no se convierten a peso con un factor de filamento.",
    );
  }
  const factor = new Decimal(input.factor);
  if (factor.lte(0)) {
    throw new AppError("invalid_uom_factor", "El factor de conversión debe ser mayor a cero.");
  }
  const major = new Decimal(input.onHand).mul(input.cost.toMajor()).div(factor);
  return Money.fromMajor(
    major.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    input.cost.currency,
  );
}
