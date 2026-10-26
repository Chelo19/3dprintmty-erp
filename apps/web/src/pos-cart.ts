import { Money, parseQty } from "@3dprintmty/domain";
import { calculateMxTax } from "@3dprintmty/fiscal";

export interface PosItem {
  id: string; kind: "product" | "service"; sku: string; name: string;
  category?: "service" | "finished" | "product" | "supply" | "mixed";
  unitPrice: string; available: string | null; uom: string;
}
export interface PosCartLine extends PosItem {
  quantity: string; discount: string; vatRate: string; isrRate: string;
}
export const posKey = (item: Pick<PosItem, "id" | "kind">) => `${item.kind}:${item.id}`;
export function posTotals(lines: PosCartLine[]) {
  for (const line of lines) {
    if (parseQty(line.quantity) <= 0n) throw new Error("La cantidad debe ser mayor a cero.");
    if (Money.fromMajor(line.unitPrice).minor < 0n) throw new Error("El precio no puede ser negativo.");
  }
  return calculateMxTax({ lines: lines.map((line) => ({ ...line, description: line.name })), rate: "0", isrRate: "0" });
}
