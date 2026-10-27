import { describe, expect, it } from "vitest";
import { addPurchaseItem, purchaseCartSummary, type PurchaseCatalogItem } from "./purchase-cart";
const item: PurchaseCatalogItem = { id: "product", sku: "P-1", name: "Producto", type: "product", cost: "332.42", purchaseUom: "EA" };

describe("captura de compra como carrito", () => {
  it("toma el costo del catálogo y recalcula el importe al agregar cantidades", () => {
    const first = addPurchaseItem([], item, () => "line");
    expect(first[0]).toMatchObject({ quantity: "1", unitCost: "332.42" });
    const lines = addPurchaseItem(addPurchaseItem(first, item), item);
    expect(lines).toHaveLength(1);
    expect(purchaseCartSummary(lines)).toMatchObject({ total: "997.26", lines: [{ itemId: "product", kind: "product", quantity: "3", amount: "997.26" }] });
  });
  it("conserva el costo editado aunque se agregue de nuevo el mismo artículo", () => {
    const lines = addPurchaseItem([], item, () => "line").map((line) => ({ ...line, unitCost: "10.50" }));
    const result = addPurchaseItem(lines, { ...item, cost: "999" });
    expect(result[0]?.unitCost).toBe("10.50");
    expect(purchaseCartSummary(result).total).toBe("21.00");
  });
  it("usa el costo por kg del filamento sin volver a multiplicarlo por mil", () => {
    const lines = addPurchaseItem([], { ...item, id: "filament", type: "filament", purchaseUom: "KG", cost: "250.00" }, () => "line").map((line) => ({ ...line, quantity: "0.5" }));
    expect(purchaseCartSummary(lines)).toMatchObject({ total: "125.00", lines: [{ kind: "filament", quantity: "0.5", amount: "125.00" }] });
  });
  it("suma importes redondeados por partida y mantiene servicios y gastos manuales", () => {
    const first = addPurchaseItem([], { ...item, cost: "0.01", type: "supply" }, () => "line").map((line) => ({ ...line, quantity: "1.5" }));
    const summary = purchaseCartSummary([...first, { key: "manual", type: "service", name: "Mensajería", sku: "", purchaseUom: "PZA", quantity: "1", unitCost: "55.34" }]);
    expect(summary.total).toBe("55.36");
    expect(summary.lines[0]).toMatchObject({ kind: "product", amount: "0.02" });
    expect(summary.lines[1]).toMatchObject({ kind: "service", description: "Mensajería", amount: "55.34" });
  });
  it("exige capturar costos ausentes y rechaza cantidades o costos negativos", () => {
    const unknown = addPurchaseItem([], { ...item, cost: null }, () => "line");
    expect(unknown[0]?.unitCost).toBe("");
    expect(() => purchaseCartSummary(unknown)).toThrow("Captura el costo unitario");
    const first = addPurchaseItem([], item, () => "line");
    for (const patch of [{ quantity: "0" }, { quantity: "-1" }, { unitCost: "-10" }]) expect(() => purchaseCartSummary(first.map((line) => ({ ...line, ...patch })))).toThrow();
    expect(() => purchaseCartSummary([{ key: "manual", type: "other", name: " ", sku: "", purchaseUom: "PZA", quantity: "1", unitCost: "10" }])).toThrow("Describe");
  });
});
