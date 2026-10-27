import { Money, formatQty, parseQty } from "@3dprintmty/domain";
import { expenseKindForType } from "./purchase-types";

export interface PurchaseCatalogItem {
  id: string; sku: string; name: string; type: "product" | "supply" | "filament";
  cost: string | null; purchaseUom: string;
}
export interface PurchaseCartLine {
  key: string; type: PurchaseCatalogItem["type"] | "service" | "other";
  itemId?: string; name: string; sku: string; purchaseUom: string;
  quantity: string; unitCost: string;
}
export function addPurchaseItem(lines: PurchaseCartLine[], item: PurchaseCatalogItem, newKey: () => string = () => crypto.randomUUID()): PurchaseCartLine[] {
  const existing = lines.find((line) => line.itemId === item.id && line.type === item.type);
  if (!existing) return [...lines, { key: newKey(), type: item.type, itemId: item.id, name: item.name, sku: item.sku, purchaseUom: item.purchaseUom, quantity: "1", unitCost: item.cost ?? "" }];
  return lines.map((line) => {
    if (line.key !== existing.key) return line;
    let quantity = 0n;
    try { quantity = parseQty(line.quantity || "0"); } catch { /* Reemplazar una cantidad incompleta al volver a agregar. */ }
    return { ...line, quantity: formatQty(quantity + parseQty("1")) };
  });
}
export function purchaseCartSummary(lines: PurchaseCartLine[]) {
  const priced = lines.map((line) => {
    const quantity = parseQty(line.quantity);
    if (quantity <= 0n) throw new Error("La cantidad debe ser mayor a cero.");
    if (!line.unitCost.trim()) throw new Error(`Captura el costo unitario de ${line.name || "la partida"}.`);
    const cost = Money.fromMajor(line.unitCost);
    if (cost.minor < 0n) throw new Error("El costo no puede ser negativo.");
    if (!line.itemId && !line.name.trim()) throw new Error("Describe el servicio u otro gasto.");
    return { kind: expenseKindForType(line.type), itemId: line.itemId, description: line.itemId ? undefined : line.name.trim(), quantity: formatQty(quantity), amount: cost.timesQuantity(formatQty(quantity)).toMajor() };
  });
  return { lines: priced, total: Money.fromMinor(priced.reduce((sum, line) => sum + Money.fromMajor(line.amount).minor, 0n)).toMajor() };
}
