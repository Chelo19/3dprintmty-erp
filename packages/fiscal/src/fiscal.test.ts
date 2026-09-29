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
