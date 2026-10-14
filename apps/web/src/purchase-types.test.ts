import { describe, expect, it } from "vitest";
import { expenseKindForType, expenseTypeLabel, matchesPurchaseType } from "./purchase-types";

describe("clasificación de compras", () => {
  const goods = (supplyMode: string, itemClass = "finished_good") => ({ productType: itemClass, itemClass, supplyMode, status: "active" });
  it("separa productos de reventa e insumos", () => {
    expect(matchesPurchaseType(goods("both"), "product")).toBe(false);
    expect(matchesPurchaseType(goods("buy"), "product")).toBe(true);
    for (const itemClass of ["component", "raw_material"]) {
      expect(matchesPurchaseType(goods("buy", itemClass), "supply")).toBe(true);
      expect(matchesPurchaseType(goods("buy", itemClass), "product")).toBe(false);
    }
  });
  it("no permite comprar artículos de fabricación exclusiva, servicios ni inactivos", () => {
    for (const type of ["product", "supply"]) {
      expect(matchesPurchaseType(goods("make"), type)).toBe(false);
      expect(matchesPurchaseType(goods("buy", "service"), type)).toBe(false);
      expect(matchesPurchaseType(goods("both"), type)).toBe(false);
      expect(matchesPurchaseType({ ...goods("buy"), status: "inactive" }, type)).toBe(false);
    }
  });
  it("conserva el contrato de gastos y distingue el tipo al consultarlos", () => {
    for (const type of ["product", "supply"]) expect(expenseKindForType(type)).toBe("product");
    for (const type of ["filament", "service", "other"]) expect(expenseKindForType(type)).toBe(type);
    expect(expenseTypeLabel({ kind: "product", itemClass: "component", supplyMode: "buy" })).toBe("Insumo");
    expect(expenseTypeLabel({ kind: "product", itemClass: "finished_good", supplyMode: "both" })).toBe("Producto fabricado / reventa");
    expect(expenseTypeLabel({ kind: "product", itemClass: "finished_good", supplyMode: "buy" })).toBe("Producto");
    expect(expenseTypeLabel({ kind: "product" })).toBe("Producto");
  });
});
