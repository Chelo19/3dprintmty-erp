import { canPurchase } from "@3dprintmty/domain";

export const PURCHASE_TYPES: Record<string, string> = {
  product: "Productos", supply: "Insumos",
  filament: "Filamentos", service: "Servicios", other: "Otros",
};

export function expenseKindForType(type: string) {
  return type === "supply" ? "product" : type;
}

export function matchesPurchaseType(item: { productType: string; itemClass?: string; supplyMode?: string; status?: string }, type: string) {
  if (item.status === "inactive" || !canPurchase(item)) return false;
  const itemClass = item.itemClass ?? (item.productType === "resale" ? "finished_good" : item.productType);
  if (type === "supply") return itemClass === "component" || itemClass === "raw_material";
  if (itemClass !== "finished_good") return false;
  return type === "product";
}

export function expenseTypeLabel(expense: { kind: string; itemClass?: string | null; supplyMode?: string | null }) {
  if (expense.kind === "product") {
    if (expense.itemClass === "component" || expense.itemClass === "raw_material") return "Insumo";
    if (expense.supplyMode === "both") return "Producto fabricado / reventa";
    if (expense.supplyMode === "make") return "Producto fabricado";
    return "Producto";
  }
  return ({ mixed: "Compra con varias partidas", filament: "Filamento", service: "Servicio", other: "Otro" } as Record<string, string>)[expense.kind] ?? expense.kind;
}
