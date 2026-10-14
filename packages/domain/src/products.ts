export const ITEM_CLASSES = ["finished_good", "component", "raw_material"] as const;
export const SUPPLY_MODES = ["make", "buy", "both"] as const;
export type ItemClass = typeof ITEM_CLASSES[number];
export type SupplyMode = typeof SUPPLY_MODES[number];
export const SUPPLY_LABELS: Record<SupplyMode, string> = { make: "Fabricar", buy: "Comprar", both: "Fabricar o comprar" };
export function defaultSupplyMode(productType: string): SupplyMode { return productType === "finished_good" ? "make" : "buy"; }
export function canManufacture(product: { supplyMode?: string; productType: string }): boolean {
  const mode = product.supplyMode ?? defaultSupplyMode(product.productType);
  return product.productType !== "service" && (mode === "make" || mode === "both");
}
export function canPurchase(product: { supplyMode?: string; productType: string; itemClass?: string }): boolean {
  const mode = product.supplyMode ?? defaultSupplyMode(product.productType);
  const itemClass = product.itemClass ?? (product.productType === "resale" ? "finished_good" : product.productType);
  // Los productos terminados con fabricación habilitada se abastecen mediante producción.
  if (itemClass === "finished_good") return mode === "buy";
  return product.productType !== "service" && (mode === "buy" || mode === "both");
}
export function legacyProductType(itemClass: string, supplyMode: string): string {
  return itemClass === "finished_good" && supplyMode === "buy" ? "resale" : itemClass;
}
