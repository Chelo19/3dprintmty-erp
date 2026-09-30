import { describe, expect, it } from "vitest";
import {
  closeShortPlan,
  isFullyAllocated,
  orderActions,
  planOrderAllocation,
  resumeTarget,
  syncedOrderState,
  type OrderContext,
  type OrderLineSupply,
} from "./orders";
import { parseQty } from "./quantity";
import { transitionFulfillment, transitionSalesOrder } from "./states";

const q = parseQty;

function line(lineId: string, productId: string | null, quantity: string, reserved = "0", shipped = "0", stocked = true): OrderLineSupply {
  return { lineId, productId, stocked, quantity: q(quantity), reserved: q(reserved), shipped: q(shipped) };
}

function context(overrides: Partial<OrderContext> = {}): OrderContext {
  return {
    state: "confirmed",
    fulfillment: "pending",
    role: "sales",
    fullyAllocated: false,
    makeableShortage: true,
    hasDeliverable: false,
    openProduction: false,
    startedProduction: false,
    activePrefactura: false,
    paidMinor: 0n,
    amountDueMinor: 34800n,
    servicesOpen: false,
    articlesPrestados: true,
    ...overrides,
  };
}

function allowed(ctx: OrderContext, action: string) {
  return orderActions(ctx).find((item) => item.action === action);
}

describe("apartado del pedido", () => {
  it("reparte la existencia entre líneas del mismo producto en orden", () => {
    const plan = planOrderAllocation(
      [line("a", "llavero", "3"), line("b", "llavero", "2"), line("c", "pla", "200"), line("d", null, "1", "0", "0", false)],
      new Map([
        ["llavero", q("4")],
        ["pla", q("1000")],
      ]),
    );
    expect(plan).toEqual([
      { lineId: "a", productId: "llavero", reserve: q("3"), shortage: 0n },
      { lineId: "b", productId: "llavero", reserve: q("1"), shortage: q("1") },
      { lineId: "c", productId: "pla", reserve: q("200"), shortage: 0n },
    ]);
  });

  it("solo aparta lo que falta y nunca con existencia negativa", () => {
    const plan = planOrderAllocation([line("a", "llavero", "3", "1", "1")], new Map([["llavero", q("-2")]]));
    expect(plan).toEqual([{ lineId: "a", productId: "llavero", reserve: 0n, shortage: q("1") }]);
  });

  it("los servicios no bloquean el embarque", () => {
    expect(isFullyAllocated([line("a", "llavero", "2", "2"), line("s", null, "1", "0", "0", false)])).toBe(true);
    expect(isFullyAllocated([line("a", "llavero", "2", "1")])).toBe(false);
  });
});

describe("estado del pedido según surtido", () => {
  it("todo apartado va a listo para embarcar; con OP abierta, a producción", () => {
    expect(syncedOrderState("confirmed", { fullyAllocated: true, openProduction: false })).toBe("ready_to_ship");
    expect(syncedOrderState("confirmed", { fullyAllocated: false, openProduction: true })).toBe("in_production");
    expect(syncedOrderState("in_production", { fullyAllocated: false, openProduction: false })).toBe("confirmed");
    expect(syncedOrderState("ready_to_ship", { fullyAllocated: false, openProduction: false })).toBe("confirmed");
  });

  it("no mueve pedidos que decide una persona", () => {
    for (const state of ["draft", "pending", "on_hold", "shipped", "cancelled"] as const) {
      expect(syncedOrderState(state, { fullyAllocated: true, openProduction: false })).toBe(state);
    }
    expect(resumeTarget({ fullyAllocated: false, openProduction: true })).toBe("in_production");
  });

  it("la máquina de estados permite los movimientos del surtido y bloquea regresar un embarque", () => {
    expect(allowed(context({ state: "pending", articlesPrestados: false }), "confirm")?.allowed).toBe(false);
    expect(allowed(context({ state: "pending", articlesPrestados: true }), "confirm")?.allowed).toBe(true);
    expect(transitionSalesOrder("confirmed", "ready_to_ship").ok).toBe(true);
    expect(transitionSalesOrder("ready_to_ship", "cancelled").ok).toBe(true);
    expect(transitionSalesOrder("shipped", "cancelled").ok).toBe(false);
    expect(transitionSalesOrder("shipped", "ready_to_ship").ok).toBe(false);
    expect(transitionFulfillment("ready", "packing").ok).toBe(true);
    expect(transitionFulfillment("packing", "picking").ok).toBe(false);
    expect(transitionFulfillment("shipped", "pending").ok).toBe(false);
  });
});

describe("cierre incompleto", () => {
  it("cierra lo que no está apartado ni embarcado", () => {
    const plan = closeShortPlan([line("a", "llavero", "3", "1"), line("b", "pla", "200", "200"), line("s", null, "1", "0", "0", false)]);
    expect(plan.ok && plan.value).toEqual([{ lineId: "a", close: q("2") }]);
  });

  it("si no hay nada que entregar pide cancelar", () => {
    const plan = closeShortPlan([line("a", "llavero", "3")]);
    expect(!plan.ok && plan.error.code).toBe("nothing_to_deliver");
  });

  it("si ya está completo no hay nada que cerrar", () => {
    const plan = closeShortPlan([line("a", "llavero", "3", "3")]);
    expect(!plan.ok && plan.error.code).toBe("nothing_to_close");
  });
});

describe("acciones del pedido", () => {
  it("embarcar solo cuando está listo, y dice qué falta", () => {
    expect(allowed(context({ openProduction: true, state: "in_production" }), "ship")).toEqual({
      action: "ship",
      allowed: false,
      reason: "Falta terminar la producción.",
    });
    expect(allowed(context({ state: "ready_to_ship", fullyAllocated: true, fulfillment: "ready" }), "ship")?.allowed).toBe(true);
    expect(allowed(context({ state: "ready_to_ship", role: "production" }), "ship")?.reason).toBe("Tu rol no puede hacer esto.");
    expect(allowed(context({ state: "ready_to_ship", role: "warehouse" }), "ship")?.allowed).toBe(true);
    expect(allowed(context({ state: "ready_to_ship", fullyAllocated: true, fulfillment: "ready", servicesOpen: true }), "ship")?.reason).toBe(
      "Cierra los servicios del pedido antes de embarcar o entregar.",
    );
  });

  it("no se edita con OP abierta ni con prefactura vigente", () => {
    expect(allowed(context({ openProduction: true }), "edit")?.allowed).toBe(false);
    expect(allowed(context({ activePrefactura: true }), "edit")?.reason).toBe("Cancela la prefactura antes de cambiar el pedido.");
    expect(allowed(context({ state: "shipped" }), "edit")?.allowed).toBe(false);
  });

  it("cancelar exige reembolso, sin producción en piso y sin prefactura", () => {
    expect(allowed(context({ paidMinor: 100n }), "cancel")?.reason).toBe("Registra el reembolso de lo cobrado antes de cancelar.");
    expect(allowed(context({ openProduction: true, startedProduction: true }), "cancel")?.reason).toBe(
      "Hay producción en proceso; termínala o cancélala primero.",
    );
    expect(allowed(context({ openProduction: true }), "cancel")?.reason).toBe("Cancela primero las órdenes de producción del pedido.");
    expect(allowed(context({ state: "shipped" }), "cancel")?.allowed).toBe(false);
    expect(allowed(context(), "cancel")?.allowed).toBe(true);
  });

  it("completar exige saldo en cero", () => {
    expect(allowed(context({ state: "delivered" }), "complete")?.reason).toBe("Falta cobrar $348.00.");
    expect(allowed(context({ state: "delivered", amountDueMinor: 0n }), "complete")?.allowed).toBe(true);
  });

  it("fabricar lo pide producción cuando el faltante tiene BOM", () => {
    expect(allowed(context({ role: "production" }), "make")?.allowed).toBe(true);
    expect(allowed(context({ makeableShortage: false }), "make")?.allowed).toBe(false);
  });
});
