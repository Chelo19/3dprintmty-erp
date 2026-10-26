import { describe, expect, it } from "vitest";
import { posTotals, type PosCartLine } from "./pos-cart";
const line: PosCartLine = { id: "item", kind: "product", sku: "P1", name: "Pieza", unitPrice: "332.42", available: "10", uom: "pza", quantity: "3", discount: "0", vatRate: "0.16", isrRate: "0.0125" };
describe("carrito de punto de venta", () => {
  it("calcula centavos, descuentos e impuestos por partida sin redondeos de flotantes", () => {
    expect(posTotals([line, { ...line, id: "service", kind: "service", unitPrice: "55.34", discount: "6.02", vatRate: "0", isrRate: "0" }])).toMatchObject({ subtotal: "1157.26", discount: "6.02", tax: "159.56", isrWithheld: "12.47", total: "1304.35" });
  });
  it("rechaza cantidades, precios y descuentos inválidos antes de cobrar", () => {
    for (const patch of [{ quantity: "0" }, { quantity: "-1" }, { quantity: "abc" }, { unitPrice: "-1" }, { discount: "9999" }]) expect(() => posTotals([{ ...line, ...patch }])).toThrow();
  });
});
