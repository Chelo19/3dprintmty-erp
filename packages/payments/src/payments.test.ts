import { describe, expect, it } from "vitest";
import { Money } from "@3dprintmty/domain";
import { amountDue, manualPaymentPort, mercadoPagoPort, resolveSatPaymentTiming } from "./index";

describe("ledger de cobranza", () => {
  const total = Money.fromMajor("116.00");

  it("deja el saldo en parcial con un abono SPEI", () => {
    const due = amountDue(total, [
      { status: "completed", kind: "payment", amount: Money.fromMajor("50.00") },
    ]);
    expect(due.toMajor()).toBe("66.00");
    expect(resolveSatPaymentTiming("PUE", total, [
      { status: "completed", kind: "payment", amount: Money.fromMajor("50.00") },
    ])).toBe("PPD");
  });

  it("liquida y conserva PUE si el pago cubre en una exhibición", () => {
    const entries = [
      { status: "completed" as const, kind: "payment" as const, amount: Money.fromMajor("116.00") },
    ];
    expect(amountDue(total, entries).toMajor()).toBe("0.00");
    expect(resolveSatPaymentTiming("PUE", total, entries)).toBe("PUE");
  });

  it("suma reembolsos al saldo", () => {
    const due = amountDue(total, [
      { status: "completed", kind: "payment", amount: total },
      { status: "completed", kind: "refund", amount: Money.fromMajor("16.00") },
    ]);
    expect(due.toMajor()).toBe("16.00");
  });

  it("ignora pagos pendientes o anulados", () => {
    const due = amountDue(total, [
      { status: "pending", kind: "payment", amount: Money.fromMajor("116.00") },
      { status: "voided", kind: "payment", amount: Money.fromMajor("116.00") },
    ]);
    expect(due.toMajor()).toBe("116.00");
  });
});

describe("puertos de cobro", () => {
  it("registra efectivo como completado y contraentrega como pendiente", () => {
    expect(
      manualPaymentPort.recordManual?.({
        method: "efectivo",
        amount: Money.fromMajor("20.00"),
      }).status,
    ).toBe("completed");
    expect(
      manualPaymentPort.recordManual?.({
        method: "cod",
        amount: Money.fromMajor("20.00"),
      }).status,
    ).toBe("pending");
  });

  it("no cobra con Mercado Pago sin la llave del tenant", async () => {
    await expect(
      mercadoPagoPort.createCheckout?.({
        tenantId: "tenant-a",
        amount: Money.fromMajor("10.00"),
        description: "Pedido",
        credentials: null,
      }),
    ).rejects.toThrow(/llave/);
  });
});
