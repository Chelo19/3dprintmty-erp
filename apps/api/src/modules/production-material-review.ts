import { formatQty, lineRequirement, mulQty, qtyFromDb, stockUnitCostMinor } from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { centsToMajor, type BomIndex, type ProductInfo } from "./manufacturing.shared";

interface ReviewLine { kind: "filament" | "supply" | "product" | "service"; id: string; code: string; name: string; unit: string; quantity: bigint; unitMinor: Decimal | null }

export interface ReviewOrder { id: string; folio: string; productId: string; quantityOrdered: string }

/** Planning estimate from current recipes; never replaces an order's frozen requirements. */
export function productionMaterialReview(orders: ReviewOrder[], index: BomIndex, catalog: Map<string, ProductInfo>) {
  const rows = new Map<string, ReviewLine>();
  const add = (row: Omit<ReviewLine, "quantity">, quantity: bigint) => {
    const key = `${row.kind}:${row.id}`;
    const previous = rows.get(key);
    rows.set(key, { ...row, quantity: (previous?.quantity ?? 0n) + quantity });
  };
  const walk = (id: string, quantity: bigint, path: Set<string>) => {
    if (path.has(id) || path.size > 12) throw new AppError("bom_cycle", "La receta tiene un ciclo o demasiados niveles.");
    const item = catalog.get(id);
    if (!item) throw new AppError("item_not_found", "Una receta contiene un artículo que ya no está disponible.", 409);
    const lines = index.lookup(id);
    if (!lines?.length) {
      add({ id, code: item.sku, name: item.name, unit: item.stockUom,
        kind: item.productType === "filament" ? "filament" : item.itemClass === "finished_good" ? "product" : "supply",
        unitMinor: item.costMinor === null ? null : stockUnitCostMinor(item.costMinor, item.uomFactor) }, quantity);
      return;
    }
    const next = new Set(path).add(id);
    for (const line of lines) walk(line.componentId, lineRequirement(quantity, line), next);
    for (const service of index.servicesByProduct.get(id) ?? []) add({ kind: "service", id: service.serviceId, code: service.code,
      name: service.name, unit: service.unit, unitMinor: service.costMinor === null ? null : new Decimal(service.costMinor.toString()) }, mulQty(quantity, service.quantity));
    const labor = index.laborByProduct.get(id);
    if (labor?.gt(0)) add({ kind: "service", id: `routing:${id}`, code: item.sku, name: `Mano de obra de ruta · ${item.name}`, unit: "EA", unitMinor: labor }, quantity);
  };
  for (const order of orders) {
    if (!index.lookup(order.productId)?.length) throw new AppError("bom_required", `«${order.folio}» no tiene receta vigente. Revisa su receta antes de estimar materiales.`, 409);
    walk(order.productId, qtyFromDb(order.quantityOrdered), new Set());
  }
  const lines = [...rows.values()].map(row => ({ kind: row.kind, id: row.id, code: row.code, name: row.name, unit: row.unit,
    quantity: formatQty(row.quantity), unitCost: row.unitMinor?.div(100).toDecimalPlaces(6).toFixed() ?? null,
    totalCost: row.unitMinor === null ? null : centsToMajor(row.unitMinor.mul(formatQty(row.quantity))) }));
  const kindOrder = { filament: 0, supply: 1, product: 2, service: 3 };
  lines.sort((a,b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, "es"));
  const subtotal = (selected: typeof lines) => selected.some(row => row.totalCost === null) ? null : selected.reduce((sum,row) => sum.add(row.totalCost!), new Decimal(0)).toFixed(2);
  return { orders: orders.map(order => ({ id: order.id, folio: order.folio, name: catalog.get(order.productId)?.name ?? "", quantity: formatQty(qtyFromDb(order.quantityOrdered)) })),
    totalPieces: formatQty(orders.reduce((sum,order) => sum + qtyFromDb(order.quantityOrdered), 0n)), lines,
    materialCost: subtotal(lines.filter(row => row.kind !== "service")), serviceCost: subtotal(lines.filter(row => row.kind === "service")),
    totalCost: subtotal(lines), missingCosts: lines.some(row => row.totalCost === null) };
}
