import { describe, expect, it } from "vitest";
import { Money } from "./money";
import { assertPostalCode, assertRfc, isValidRfc } from "./mx";
import { canReadSalePrice } from "./roles";
import { canIssuePrefactura, exceedsCredit, transitionQuote, transitionSalesOrder } from "./states";
import { convertQuantity, valueStock } from "./uom";

describe("dinero", () => {
  it("suma centavos sin error binario", () => {
    const total = Money.fromMajor("0.10").add(Money.fromMajor("0.20"));
    expect(total.toMajor()).toBe("0.30");
  });

  it("rechaza más de dos decimales", () => {
    expect(() => Money.fromMajor("10.555")).toThrow(/dos decimales/);
  });

  it("multiplica cantidad decimal y redondea a centavo", () => {
    expect(Money.fromMajor("10.00").timesQuantity("2.5").toMajor()).toBe("25.00");
    expect(Money.fromMajor("10.01").timesQuantity("0.5").toMajor()).toBe("5.01");
  });
});

describe("cotizaciones y crédito", () => {
  it("acepta una cotización enviada y rechaza convertir un borrador", () => {
    expect(transitionQuote("sent", "accepted").ok).toBe(true);
    expect(transitionQuote("draft", "converted").ok).toBe(false);
  });

  it("marca exceso de límite de crédito", () => {
    expect(exceedsCredit(10_000n, 8_000n, 3_000n)).toBe(true);
    expect(exceedsCredit(10_000n, 4_000n, 3_000n)).toBe(false);
  });
});

describe("unidades de filamento", () => {
  it("convierte kilogramos a gramos", () => {
    expect(convertQuantity("1", "KG", "G")).toBe("1000");
    expect(convertQuantity("500", "G", "KG")).toBe("0.5");
  });

  it("valúa 500 g comprados a $250/kg en $125.00", () => {
    const value = valueStock({
      onHand: "500",
      stockUom: "G",
      cost: Money.fromMajor("250.00"),
      purchaseUom: "KG",
      factor: "1000",
    });
    expect(value.toMajor()).toBe("125.00");
    expect(value.format("es-MX")).toMatch(/125/);
  });
});

describe("RFC y código postal", () => {
  it("acepta persona moral, física y genéricos", () => {
    expect(assertRfc("abc 010203 xxx")).toBe("ABC010203XXX");
    expect(isValidRfc("XAXX010101000")).toBe(true);
    expect(isValidRfc("XEXX010101000")).toBe(true);
    expect(isValidRfc("ABC")).toBe(false);
  });

  it("exige CP de 5 dígitos", () => {
    expect(assertPostalCode("44100")).toBe("44100");
    expect(() => assertPostalCode("4410")).toThrow(/5 dígitos/);
  });
});

describe("máquina de estados del pedido", () => {
  it("confirma y prohíbe saltos", () => {
    expect(transitionSalesOrder("pending", "confirmed").ok).toBe(true);
    expect(transitionSalesOrder("draft", "shipped").ok).toBe(false);
    expect(transitionSalesOrder("confirmed", "cancelled").ok).toBe(true);
  });

  it("no prefactura un pedido pending", () => {
    expect(canIssuePrefactura("pending")).toBe(false);
    expect(canIssuePrefactura("confirmed")).toBe(true);
  });
});

describe("precios de venta", () => {
  it("oculta el precio de venta a producción", () => {
    expect(canReadSalePrice("production")).toBe(false);
    expect(canReadSalePrice("sales")).toBe(true);
  });
});
