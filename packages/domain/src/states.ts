import { AppError, err, ok, type Result } from "@3dprintmty/shared";

export const QUOTE_STATES = ["draft", "sent", "accepted", "converted", "expired", "void"] as const;

export type QuoteState = (typeof QUOTE_STATES)[number];

const QUOTE_TRANSITIONS: Record<QuoteState, readonly QuoteState[]> = {
  draft: ["sent", "void"],
  sent: ["accepted", "expired", "void"],
  accepted: ["converted", "void"],
  converted: [],
  expired: [],
  void: [],
};

export function transitionQuote(from: QuoteState, to: QuoteState): Result<QuoteState> {
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    return err(new AppError("invalid_transition", `La cotización no puede pasar de ${from} a ${to}.`));
  }
  return ok(to);
}

export function exceedsCredit(limitMinor: bigint, exposureMinor: bigint, orderMinor: bigint): boolean {
  return exposureMinor + orderMinor > limitMinor;
}

export const SALES_ORDER_STATES = [
  "draft",
  "pending",
  "confirmed",
  "in_production",
  "ready_to_ship",
  "shipped",
  "delivered",
  "completed",
  "on_hold",
  "cancelled",
] as const;

export type SalesOrderState = (typeof SALES_ORDER_STATES)[number];

const SALES_ORDER_TRANSITIONS: Record<SalesOrderState, readonly SalesOrderState[]> = {
  draft: ["pending", "cancelled"],
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_production", "ready_to_ship", "on_hold", "cancelled"],
  on_hold: ["confirmed", "in_production", "ready_to_ship", "cancelled"],
  in_production: ["ready_to_ship", "confirmed", "on_hold", "cancelled"],
  ready_to_ship: ["shipped", "confirmed", "in_production", "on_hold", "cancelled"],
  shipped: ["delivered"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
};

export function transitionSalesOrder(
  from: SalesOrderState,
  to: SalesOrderState,
): Result<SalesOrderState> {
  if (!SALES_ORDER_TRANSITIONS[from].includes(to)) {
    return err(
      new AppError(
        "invalid_transition",
        `El pedido no puede pasar de ${from} a ${to}.`,
      ),
    );
  }
  return ok(to);
}

export function canIssuePrefactura(state: SalesOrderState): boolean {
  return [
    "confirmed",
    "in_production",
    "ready_to_ship",
    "shipped",
    "delivered",
    "completed",
  ].includes(state);
}

export const PAYMENT_STATES = ["pending", "partial", "paid", "refunded", "cancelled"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_ENTRY_STATES = ["pending", "completed", "failed", "voided"] as const;
export type PaymentEntryState = (typeof PAYMENT_ENTRY_STATES)[number];

export const FULFILLMENT_STATES = [
  "pending",
  "ready",
  "picking",
  "packing",
  "shipped",
  "delivered",
] as const;

export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

const FULFILLMENT_TRANSITIONS: Record<FulfillmentState, readonly FulfillmentState[]> = {
  pending: ["ready"],
  ready: ["picking", "packing", "shipped", "pending"],
  picking: ["packing", "shipped", "pending"],
  packing: ["shipped", "pending"],
  shipped: ["delivered"],
  delivered: [],
};

export function transitionFulfillment(from: FulfillmentState, to: FulfillmentState): Result<FulfillmentState> {
  if (from === to) return ok(to);
  if (!FULFILLMENT_TRANSITIONS[from].includes(to)) {
    return err(new AppError("invalid_transition", `El surtido no puede pasar de ${from} a ${to}.`, 409));
  }
  return ok(to);
}

export const PRODUCTION_ORDER_STATES = [
  "draft",
  "released",
  "scheduled",
  "in_progress",
  "qc_hold",
  "completed",
  "closed",
  "on_hold",
  "cancelled",
] as const;

export type ProductionOrderState = (typeof PRODUCTION_ORDER_STATES)[number];

const PRODUCTION_TRANSITIONS: Record<ProductionOrderState, readonly ProductionOrderState[]> = {
  draft: ["released", "cancelled"],
  released: ["scheduled", "in_progress", "on_hold", "cancelled"],
  scheduled: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["qc_hold", "completed", "on_hold", "cancelled"],
  qc_hold: ["in_progress", "completed", "cancelled"],
  completed: ["closed"],
  on_hold: ["released", "scheduled", "in_progress", "cancelled"],
  closed: [],
  cancelled: [],
};

export function transitionProductionOrder(
  from: ProductionOrderState,
  to: ProductionOrderState,
): Result<ProductionOrderState> {
  if (!PRODUCTION_TRANSITIONS[from].includes(to)) {
    return err(
      new AppError(
        "invalid_transition",
        `La orden de producción no puede pasar de ${from} a ${to}.`,
      ),
    );
  }
  return ok(to);
}

/** Estados en los que la OP todavía cuenta como salida programada y demanda de material. */
export function isOpenProductionOrder(state: ProductionOrderState): boolean {
  return ["draft", "released", "scheduled", "in_progress", "on_hold"].includes(state);
}

export const PURCHASE_ORDER_STATES = [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "closed",
  "cancelled",
] as const;

export type PurchaseOrderState = (typeof PURCHASE_ORDER_STATES)[number];

const PURCHASE_TRANSITIONS: Record<PurchaseOrderState, readonly PurchaseOrderState[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["partially_received", "received", "cancelled"],
  partially_received: ["partially_received", "received", "closed"],
  received: ["closed"],
  closed: [],
  cancelled: [],
};

export function transitionPurchaseOrder(
  from: PurchaseOrderState,
  to: PurchaseOrderState,
): Result<PurchaseOrderState> {
  if (!PURCHASE_TRANSITIONS[from].includes(to)) {
    return err(new AppError("invalid_transition", `La orden de compra no puede pasar de ${from} a ${to}.`));
  }
  return ok(to);
}

/** Solo lo colocado con el proveedor cuenta como suministro en camino. */
export function countsAsIncoming(state: PurchaseOrderState): boolean {
  return state === "ordered" || state === "partially_received";
}

export const PLANNED_ORDER_STATES = ["planned", "firmed", "released", "cancelled"] as const;
export type PlannedOrderState = (typeof PLANNED_ORDER_STATES)[number];

const PLANNED_TRANSITIONS: Record<PlannedOrderState, readonly PlannedOrderState[]> = {
  planned: ["firmed", "released", "cancelled"],
  firmed: ["released", "cancelled"],
  released: [],
  cancelled: [],
};

export function transitionPlannedOrder(from: PlannedOrderState, to: PlannedOrderState): Result<PlannedOrderState> {
  if (!PLANNED_TRANSITIONS[from].includes(to)) {
    return err(new AppError("invalid_transition", `La orden planeada no puede pasar de ${from} a ${to}.`));
  }
  return ok(to);
}

export const SPOOL_STATES = ["available", "in_use", "empty", "scrapped"] as const;
export type SpoolState = (typeof SPOOL_STATES)[number];

/** Por debajo de este peso el rollo ya no alcanza para una pieza y se marca vacío. */
export const SPOOL_EMPTY_THRESHOLD_G = 5n;

export function spoolStateAfterUse(remainingGrams: bigint, scale: bigint): SpoolState {
  return remainingGrams < SPOOL_EMPTY_THRESHOLD_G * scale ? "empty" : "in_use";
}

export const PREFACTURA_STATES = ["issued", "void"] as const;
export type PrefacturaState = (typeof PREFACTURA_STATES)[number];

export const QC_RIGOR = ["off", "basic", "full"] as const;
export type QcRigor = (typeof QC_RIGOR)[number];

export const QC_GATES = ["off", "warn", "block"] as const;
export type QcGate = (typeof QC_GATES)[number];

export function requiresInspection(rigor: QcRigor, gate: QcGate): boolean {
  return rigor !== "off" && gate !== "off";
}

/**
 * Qué hace la OP después de una inspección.
 * block: una falla no deja recibir terminado; se retrabaja o se desecha.
 * warn: la falla se registra y la OP puede terminar.
 */
export function qcOutcome(
  gate: QcGate,
  result: "pass" | "fail",
  disposition: "rework" | "scrap" | undefined,
): Result<"complete" | "rework"> {
  if (result === "pass" || gate !== "block") return ok("complete");
  if (disposition === "rework") return ok("rework");
  if (disposition === "scrap") return ok("complete");
  return err(
    new AppError(
      "qc_blocked",
      "La inspección falló y la calidad está en modo bloqueo. Indica si se retrabaja o se desecha.",
      409,
    ),
  );
}
