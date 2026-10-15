import { describe, expect, it } from "vitest";
import { countryPolicy, PREFACTURA_TITLE } from "./index";

const emitter = {
  legalName: "Taller Norte",
  rfc: "TNO010203AB1",
  taxRegime: "626",
  postalCode: "64000",
};

describe("IVA México", () => {
  const tax = countryPolicy("MX").taxEngine;

  it("retiene ISR sobre el neto después de descuentos, sin incluir IVA", () => {
    const result = tax.calculate({ lines: [{ description: "Servicio", quantity: "1", unitPrice: "1000.00", discount: "100.00" }], rate: "0.16", isrRate: "0.0125" });
    expect(result).toMatchObject({ subtotal: "900.00", tax: "144.00", isrWithheld: "11.25", total: "1032.75", isrRate: "0.012500" });
  });
  it("redondea la retención a centavos y admite IVA cero", () => {
    expect(tax.calculate({ lines: [{ description: "Servicio", quantity: "1", unitPrice: "90.00" }], rate: "0", isrRate: "0.0125" })).toMatchObject({ isrWithheld: "1.13", total: "88.87" });
  });
  it("aplica el descuento global antes de calcular la retención", () => {
    expect(tax.calculate({ lines: [{ description: "Servicio", quantity: "1", unitPrice: "100.00" }], globalDiscount: "10.00", rate: "0.08", isrRate: "0.1" })).toMatchObject({ tax: "7.20", isrWithheld: "9.00", total: "88.20" });
  });
  it("rechaza tasas de ISR fuera de rango o no finitas", () => {
    for (const isrRate of ["-0.1", "1.01", "NaN", "Infinity"]) expect(() => tax.calculate({ lines: [{ description: "Servicio", quantity: "1", unitPrice: "100.00" }], rate: "0.16", isrRate })).toThrow();
  });

  it("calcula 16% sobre $100", () => {
    const result = tax.calculate({
      lines: [{ description: "Pieza", quantity: "1", unitPrice: "100.00" }],
      rate: "0.16",
    });
    expect(result.tax).toBe("16.00");
    expect(result.total).toBe("116.00");
  });

  it("aplica descuento de línea antes del IVA", () => {
    const result = tax.calculate({
      lines: [
        { description: "Pieza", quantity: "1", unitPrice: "100.00", discount: "10.00" },
      ],
      rate: "0.16",
    });
    expect(result.taxableBase).toBe("90.00");
    expect(result.tax).toBe("14.40");
    expect(result.total).toBe("104.40");
  });

  it("deja en cero una línea exenta y grava el resto", () => {
    const result = tax.calculate({
      lines: [
        { description: "Servicio exento", quantity: "1", unitPrice: "50.00", taxable: false },
        { description: "Pieza", quantity: "1", unitPrice: "100.00" },
      ],
      rate: "0.16",
    });
    expect(result.lines[0]?.tax).toBe("0.00");
    expect(result.tax).toBe("16.00");
    expect(result.total).toBe("166.00");
  });

  it("acepta tasa frontera 8%", () => {
    const result = tax.calculate({
      lines: [{ description: "Pieza", quantity: "1", unitPrice: "100.00" }],
      rate: "0.08",
    });
    expect(result.tax).toBe("8.00");
    expect(result.total).toBe("108.00");
  });

  it("redondea el impuesto a centavos", () => {
    const result = tax.calculate({
      lines: [{ description: "Pieza", quantity: "1", unitPrice: "99.99" }],
      rate: "0.16",
    });
    expect(result.tax).toBe("16.00");
    expect(result.total).toBe("115.99");
  });
});

describe("prefactura", () => {
  it("se identifica como nota de venta y no como CFDI", () => {
    const issued = countryPolicy("MX").invoiceEngine.issue({
      emitter,
      receiver: {
        kind: "persona_moral",
        legalName: "Cliente SA de CV",
        rfc: "CLI010203AB1",
        postalCode: "44100",
        cfdiUse: "G03",
      },
      lines: [{ description: "Soporte", quantity: "2", unitPrice: "80.00" }],
      taxRate: "0.16",
      intendedPayment: "PUE",
      satPaymentForm: "03",
      series: "A",
    });
    expect(issued.kind).toBe("prefactura");
    expect(issued.title).toBe(PREFACTURA_TITLE);
    expect(issued.title.toLowerCase()).toContain("no es un cfdi");
    expect(issued.title).not.toMatch(/^factura$/i);
    expect(issued.incomplete).toBe(false);
    expect(issued.tax.total).toBe("185.60");
  });

  it("marca público en general si el RFC del receptor falla", () => {
    const issued = countryPolicy("MX").invoiceEngine.issue({
      emitter,
      receiver: {
        kind: "persona_fisica",
        legalName: "Ana López",
        rfc: "MALO",
        postalCode: "44100",
      },
      lines: [{ description: "Pieza", quantity: "1", unitPrice: "10.00" }],
      taxRate: "0.16",
      intendedPayment: "PUE",
      satPaymentForm: "01",
      series: "A",
    });
    expect(issued.incomplete).toBe(true);
    expect(issued.receiver.rfc).toBe("XAXX010101000");
    expect(issued.receiver.kind).toBe("publico_general");
  });
});

describe("puerto de país", () => {
  it("deja Estados Unidos sin activar", () => {
    expect(() => countryPolicy("US").taxEngine.calculate({ lines: [], rate: "0" })).toThrow(
      /México/,
    );
  });
});


describe("impuestos por partida", () => {
  const tax = countryPolicy("MX").taxEngine;
  it("mezcla exento, tasa cero y producto con IVA e ISR después del descuento", () => {
    const result = tax.calculate({ rate: "0.16", isrRate: "0.10", lines: [
      { description: "Servicio", quantity: "1", unitPrice: "100", vatExempt: true, isrRate: "0" },
      { description: "Producto", quantity: "1", unitPrice: "100", discount: "10", vatRate: "0.16", isrRate: "0.0125" },
      { description: "Tasa cero", quantity: "1", unitPrice: "100", vatRate: "0", isrRate: "0" },
    ] });
    expect(result).toMatchObject({ tax: "14.40", isrWithheld: "1.13", total: "303.27" });
    expect(result.lines[0]).toMatchObject({ vatExempt: true, tax: "0.00", isrWithheld: "0.00" });
    expect(result.lines[1]).toMatchObject({ net: "90.00", tax: "14.40", isrRate: "0.012500", isrWithheld: "1.13" });
    expect(result.lines[2]).toMatchObject({ vatExempt: false, rate: "0.000000", tax: "0.00" });
  });
  it("suma las retenciones redondeadas por partida, sin retener sobre las otras bases", () => {
    const result = tax.calculate({ rate: "0", lines: [
      { description: "A", quantity: "1", unitPrice: "0.50", isrRate: "0.01" },
      { description: "B", quantity: "1", unitPrice: "0.50", isrRate: "0.01" },
      { description: "C", quantity: "1", unitPrice: "100", isrRate: "0" },
    ] });
    expect(result.isrWithheld).toBe("0.02");
    expect(result.total).toBe("100.98");
  });
  it("valida tasas por partida incluso cuando el IVA es exento", () => {
    for (const rate of ["-0.1", "1.1", "NaN", "Infinity"]) {
      for (const field of ["vatRate", "isrRate"]) expect(() => tax.calculate({ rate: "0.16", lines: [{ description: "A", quantity: "1", unitPrice: "100", vatExempt: true, [field]: rate }] })).toThrow();
    }
  });
});
