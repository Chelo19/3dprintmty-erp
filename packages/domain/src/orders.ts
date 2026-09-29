import { AppError, err, ok, type Result } from "@3dprintmty/shared";
import { Money } from "./money";
import { maxQty, minQty } from "./quantity";
import type { TenantRole } from "./roles";
import { canIssuePrefactura, type FulfillmentState, type SalesOrderState } from "./states";

/** Una línea del pedido vista desde el surtido. Cantidades en escala de `parseQty`. */
export interface OrderLineSupply {
  lineId: string;
  productId: string | null;
  /** Falso para servicios y partidas libres: no salen del almacén. */
  stocked: boolean;
  /** Cantidad vigente: lo pedido menos lo cerrado incompleto. */
  quantity: bigint;
  reserved: bigint;
  shipped: bigint;
}

export interface LineAllocation {
  lineId: string;
  productId: string;
  reserve: bigint;
  shortage: bigint;
}

export function openQuantity(line: OrderLineSupply): bigint {
  if (!line.stocked) return 0n;
  return maxQty(0n, line.quantity - line.reserved - line.shipped);
}

/** Reparte la existencia disponible entre las líneas, en el orden del pedido. */
export function planOrderAllocation(lines: OrderLineSupply[], available: Map<string, bigint>): LineAllocation[] {
  const left = new Map(available);
  const plan: LineAllocation[] = [];
  for (const line of lines) {
    if (!line.stocked || !line.productId) continue;
    const open = openQuantity(line);
    if (open === 0n) continue;
    const free = maxQty(0n, left.get(line.productId) ?? 0n);
    const reserve = minQty(open, free);
    left.set(line.productId, free - reserve);
    plan.push({ lineId: line.lineId, productId: line.productId, reserve, shortage: open - reserve });
  }
  return plan;
}

export function isFullyAllocated(lines: OrderLineSupply[]): boolean {
  return lines.every((line) => openQuantity(line) === 0n);
}

const OPEN_FULFILLMENT_STATES: readonly SalesOrderState[] = ["confirmed", "in_production", "ready_to_ship"];

/**
 * Estado que corresponde a un pedido abierto según lo apartado y lo que hay en producción.
 * Fuera de confirmado, en producción y listo para embarcar, el estado lo decide una persona.
 */
export function syncedOrderState(
  current: SalesOrderState,
  context: { fullyAllocated: boolean; openProduction: boolean },
): SalesOrderState {
  if (!OPEN_FULFILLMENT_STATES.includes(current)) return current;
  return resumeTarget(context);
}

/** A dónde regresa un pedido en pausa. */
export function resumeTarget(context: { fullyAllocated: boolean; openProduction: boolean }): SalesOrderState {
  if (context.fullyAllocated) return "ready_to_ship";
  if (context.openProduction) return "in_production";
  return "confirmed";
}

/**
 * Cierre incompleto: cada línea surtible se queda con lo que ya está apartado o embarcado.
 * Regresa cuánto se cierra de cada línea.
 */
export function closeShortPlan(lines: OrderLineSupply[]): Result<Array<{ lineId: string; close: bigint }>> {
  const stocked = lines.filter((line) => line.stocked);
  const plan = stocked
    .map((line) => ({ lineId: line.lineId, close: openQuantity(line) }))
    .filter((item) => item.close > 0n);
  if (!plan.length) {
    return err(new AppError("nothing_to_close", "No hay pendientes por cerrar: el pedido ya está completo.", 409));
  }
  const deliverable = stocked.some((line) => line.reserved + line.shipped > 0n);
  if (!deliverable) {
    return err(
      new AppError("nothing_to_deliver", "No hay nada apartado para entregar. Cancela el pedido en lugar de cerrarlo incompleto.", 409),
    );
  }
  return ok(plan);
}

export const ORDER_ACTIONS = [
  "submit",
  "confirm",
  "edit",
  "allocate",
  "make",
  "prefactura",
  "pick",
  "pack",
  "ship",
  "deliver",
  "complete",
  "hold",
  "resume",
  "close_short",
  "cancel",
] as const;

export type OrderAction = (typeof ORDER_ACTIONS)[number];

export interface OrderActionState {
  action: OrderAction;
  allowed: boolean;
  /** Por qué no se puede, en español. Nulo si se puede. */
  reason: string | null;
}

export interface OrderContext {
  state: SalesOrderState;
  fulfillment: FulfillmentState;
  role: TenantRole;
  fullyAllocated: boolean;
  /** Hay faltante que se puede fabricar con BOM y ruta. */
  makeableShortage: boolean;
  /** Algo apartado o embarcado que se pueda entregar. */
  hasDeliverable: boolean;
  /** OP abiertas ligadas al pedido (borrador a calidad). */
  openProduction: boolean;
  /** OP con trabajo en piso (en proceso o en calidad). */
  startedProduction: boolean;
  activePrefactura: boolean;
  paidMinor: bigint;
  amountDueMinor: bigint;
  /** Algún servicio del pedido sigue sin prestarse, aceptarse o condonarse. */
  servicesOpen: boolean;
}

const SALES: readonly TenantRole[] = ["owner", "admin", "sales"];
const SHIPPERS: readonly TenantRole[] = ["owner", "admin", "sales", "warehouse"];
const MAKERS: readonly TenantRole[] = ["owner", "admin", "production"];
const LIVE: readonly SalesOrderState[] = ["draft", "pending", "confirmed", "in_production", "ready_to_ship", "on_hold"];

const STATE_LABEL: Record<SalesOrderState, string> = {
  draft: "borrador",
  pending: "pendiente",
  confirmed: "confirmado",
  in_production: "en producción",
  ready_to_ship: "listo para embarcar",
  shipped: "embarcado",
  delivered: "entregado",
  completed: "completado",
  on_hold: "en pausa",
  cancelled: "cancelado",
};

/**
 * Qué puede hacer este usuario con el pedido y, si no, por qué.
 * La pantalla deshabilita la acción y muestra el motivo en lugar de esconderla.
 */
export function orderActions(context: OrderContext): OrderActionState[] {
  const { state } = context;
  const result: OrderActionState[] = [];
  const add = (action: OrderAction, roles: readonly TenantRole[], checks: Array<[boolean, string]>) => {
    if (!roles.includes(context.role)) {
      result.push({ action, allowed: false, reason: "Tu rol no puede hacer esto." });
      return;
    }
    const failed = checks.find(([passes]) => !passes);
    result.push({ action, allowed: !failed, reason: failed ? failed[1] : null });
  };
  const inState = (states: readonly SalesOrderState[]) => states.includes(state);
  const stateReason = `El pedido está ${STATE_LABEL[state]}.`;

  add("submit", SALES, [[state === "draft", stateReason]]);
  add("confirm", SALES, [[state === "pending", state === "draft" ? "Primero pásalo a pendiente." : stateReason]]);
  add("edit", SALES, [
    [inState(["draft", "pending", "confirmed", "ready_to_ship", "on_hold"]), stateReason],
    [!context.openProduction, "Ya hay una orden de producción para este pedido."],
    [!context.activePrefactura, "Cancela la prefactura antes de cambiar el pedido."],
  ]);
  add("allocate", SHIPPERS, [
    [inState(["confirmed", "in_production"]), stateReason],
    [!context.fullyAllocated, "Todo está apartado."],
  ]);
  add("make", MAKERS, [
    [inState(["confirmed", "in_production"]), stateReason],
    [context.makeableShortage, context.fullyAllocated ? "Todo está apartado." : "Lo que falta no tiene BOM y ruta para fabricarse."],
  ]);
  add("prefactura", SALES, [
    [canIssuePrefactura(state), state === "cancelled" ? stateReason : "Confirma el pedido antes de prefacturar."],
    [!context.activePrefactura, "El pedido ya tiene una prefactura vigente."],
  ]);
  add("pick", SHIPPERS, [
    [state === "ready_to_ship", readyReason(context)],
    [context.fulfillment === "ready", "El surtido ya empezó."],
  ]);
  add("pack", SHIPPERS, [
    [state === "ready_to_ship", readyReason(context)],
    [context.fulfillment === "ready" || context.fulfillment === "picking", "Ya está empacado."],
  ]);
  add("ship", SHIPPERS, [
    [state === "ready_to_ship", readyReason(context)],
    [!context.servicesOpen, "Cierra los servicios del pedido antes de embarcar o entregar."],
  ]);
  add("deliver", SALES, [[state === "shipped", state === "delivered" || state === "completed" ? "Ya se entregó." : "Primero embárcalo."]]);
  add("complete", SALES, [
    [state === "delivered", state === "completed" ? "Ya está completado." : "Se completa después de entregarlo."],
    [context.amountDueMinor <= 0n, `Falta cobrar ${Money.fromMinor(context.amountDueMinor).format("es-MX")}.`],
  ]);
  add("hold", SALES, [[inState(["confirmed", "in_production", "ready_to_ship"]), stateReason]]);
  add("resume", SALES, [[state === "on_hold", "El pedido no está en pausa."]]);
  add("close_short", SALES, [
    [inState(["confirmed", "in_production", "on_hold"]), stateReason],
    [!context.fullyAllocated, "No falta nada por surtir."],
    [context.hasDeliverable, "No hay nada apartado para entregar; cancélalo."],
    [!context.openProduction, openProductionReason(context)],
    [!context.activePrefactura, "Cancela la prefactura antes de cambiar el pedido."],
  ]);
  add("cancel", SALES, [
    [LIVE.includes(state), stateReason],
    [!context.openProduction, openProductionReason(context)],
    [!context.activePrefactura, "Cancela la prefactura antes de cancelar el pedido."],
    [context.paidMinor <= 0n, "Registra el reembolso de lo cobrado antes de cancelar."],
  ]);
  return result;
}

function openProductionReason(context: OrderContext): string {
  return context.startedProduction
    ? "Hay producción en proceso; termínala o cancélala primero."
    : "Cancela primero las órdenes de producción del pedido.";
}

function readyReason(context: OrderContext): string {
  if (context.state === "on_hold") return "El pedido está en pausa.";
  if (["shipped", "delivered", "completed"].includes(context.state)) return "El pedido ya se embarcó.";
  if (["draft", "pending"].includes(context.state)) return "Confirma el pedido primero.";
  if (context.state === "cancelled") return "El pedido está cancelado.";
  return context.openProduction ? "Falta terminar la producción." : "Falta apartar existencia.";
}

/** Falla con 409 si la acción no está permitida para este contexto. */
export function assertOrderAction(context: OrderContext, action: OrderAction): void {
  const found = orderActions(context).find((item) => item.action === action);
  if (!found?.allowed) {
    const status = found?.reason === "Tu rol no puede hacer esto." ? 403 : 409;
    throw new AppError(status === 403 ? "forbidden" : "order_action_blocked", found?.reason ?? "No se puede.", status);
  }
}
