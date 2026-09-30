import {
  canOverrideCredit,
  canReadSalePrice,
  exceedsCredit,
  formatQty,
  isFullyAllocated,
  isPrestado,
  maxQty,
  Money,
  openQuantity,
  parseQty,
  planOrderAllocation,
  qtyFromDb,
  roundDiv,
  serviceIsSettled,
  syncedOrderState,
  transitionFulfillment,
  transitionSalesOrder,
  type FulfillmentState,
  type OrderContext,
  type OrderLineSupply,
  type SalesOrderState,
  type TenantRole,
} from "@3dprintmty/domain";
import { calculateMxTax } from "@3dprintmty/fiscal";
import { amountDue } from "@3dprintmty/payments";
import { AppError } from "@3dprintmty/shared";
import { and, asc, eq } from "drizzle-orm";
import {
  auditEvents,
  boms,
  commercialDocuments,
  companyProfiles,
  customers,
  filaments,
  payments,
  productionOrders,
  products,
  salesOrderEvents,
  salesOrderPrints,
  serviceOfferings,
  salesOrderLines,
  salesOrders,
} from "../db/schema";
import type { TenantActor } from "../http/actor";
import { audit, availableAt, defaultLocationId, isoDate, one, reserveStock, unwrap, type Db } from "./support";

export const SALES_ROLES = ["owner", "admin", "sales"] as const;
export const SHIPPER_ROLES = ["owner", "admin", "sales", "warehouse"] as const;

const OPEN_PRODUCTION = ["draft", "released", "scheduled", "in_progress", "on_hold", "qc_hold"];
const STARTED_PRODUCTION = ["in_progress", "qc_hold"];

export interface OrderRow {
  id: string;
  folio: string;
  quoteId: string | null;
  customerId: string;
  customerName: string;
  customerRfc: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  creditOverrideReason: string | null;
  locationId: string | null;
  promisedDate: string | null;
  shipTo: unknown;
  carrier: string | null;
  trackingNumber: string | null;
  shipmentFolio: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  holdReason: string | null;
  cancelReason: string | null;
  closedShortReason: string | null;
  notes: string | null;
  serviceTerms: string | null;
  paymentTerms: string | null;
  depositPercent: number;
  paymentNotes: string | null;
  createdAt: Date;
}

export interface OrderLineRow {
  id: string;
  salesOrderId: string;
  productId: string | null;
  filamentId: string | null;
  serviceId: string | null;
  printId: string | null;
  lineKind: string;
  terms: string | null;
  resolution: string;
  resolutionNote: string | null;
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  position: number;
  reservedQty: string;
  shippedQty: string;
  closedShortQty: string;
}

export interface PaymentRow {
  id: string;
  salesOrderId?: string;
  orderId?: string;
  folio?: string;
  method: string;
  kind: string;
  status: string;
  amountMinor: bigint;
  reference: string | null;
  note: string | null;
  createdAt?: Date;
}

export interface PricedLineInput {
  productId?: string | null;
  filamentId?: string | null;
  serviceId?: string | null;
  lineKind?: "product" | "filament" | "service";
  sku?: string;
  terms?: string | null;
  uom?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount?: string;
}

export function effectiveQty(line: Pick<OrderLineRow, "quantity" | "closedShortQty">): bigint {
  return qtyFromDb(line.quantity) - qtyFromDb(line.closedShortQty ?? "0");
}

export async function loadOrder(db: Db, id: string): Promise<OrderRow> {
  return one(db, salesOrders, salesOrders.id, id, "No encontramos ese pedido.");
}

export async function loadOrderLines(db: Db, orderId: string): Promise<OrderLineRow[]> {
  return db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.position), asc(salesOrderLines.createdAt));
}

export async function orderSupply(db: Db, lines: OrderLineRow[]): Promise<OrderLineSupply[]> {
  return lines.map((line) => ({
    lineId: line.id,
    productId: line.productId ?? line.filamentId,
    stocked: line.lineKind !== "service" && line.lineKind !== "filament" && Boolean(line.productId),
    quantity: effectiveQty(line),
    reserved: qtyFromDb(line.reservedQty),
    shipped: qtyFromDb(line.shippedQty),
  }));
}

export async function orderLocation(db: Db, order: Pick<OrderRow, "locationId">): Promise<string> {
  return order.locationId ?? defaultLocationId(db);
}

/** OP ligadas al pedido y lo que todavía van a entregar por producto. */
export async function productionFor(db: Db, orderId: string) {
  const rows = await db.select().from(productionOrders).where(eq(productionOrders.salesOrderId, orderId));
  const pendingOutput = new Map<string, bigint>();
  for (const row of rows) {
    if (!OPEN_PRODUCTION.includes(row.status)) continue;
    const coming =
      row.status === "qc_hold"
        ? qtyFromDb(row.quantityCompleted)
        : maxQty(0n, qtyFromDb(row.quantityOrdered) - qtyFromDb(row.quantityScrapped));
    pendingOutput.set(row.productId, (pendingOutput.get(row.productId) ?? 0n) + coming);
  }
  return {
    rows,
    open: rows.some((row: { status: string }) => OPEN_PRODUCTION.includes(row.status)),
    started: rows.some((row: { status: string }) => STARTED_PRODUCTION.includes(row.status)),
    pendingOutput,
  };
}

/** Productos terminados o componentes con BOM activo. */
export async function manufacturableIds(db: Db, productIds: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  for (const id of new Set(productIds)) {
    const [product] = await db
      .select({ productType: products.productType, status: products.status })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    if (!product || product.status === "inactive") continue;
    if (product.productType !== "finished_good") continue;
    const [bom] = await db
      .select({ id: boms.id })
      .from(boms)
      .where(and(eq(boms.productId, id), eq(boms.active, true)))
      .limit(1);
    if (bom) result.add(id);
  }
  return result;
}

/** Qué le falta al pedido para quedar listo, separado de la fabricación de productos. */
export function supplyPicture(
  lines: OrderLineRow[],
  supply: OrderLineSupply[],
  makeable: Set<string>,
  printsOpen: boolean,
): { printsOpen: boolean; filamentShort: boolean; productToBuy: boolean; productToMake: boolean } {
  let filamentShort = false;
  let productToBuy = false;
  let productToMake = false;
  for (const [index, line] of lines.entries()) {
    const row = supply[index];
    if (!row || openQuantity(row) === 0n) continue;
    if (line.filamentId) {
      filamentShort = true;
      continue;
    }
    if (line.productId && makeable.has(line.productId)) productToMake = true;
    else if (line.productId) productToBuy = true;
  }
  return { printsOpen, filamentShort, productToBuy, productToMake };
}

/** Faltante por producto que ninguna OP abierta cubre todavía. */
export function uncoveredShortage(supply: OrderLineSupply[], pendingOutput: Map<string, bigint>): Map<string, bigint> {
  const open = new Map<string, bigint>();
  for (const line of supply) {
    if (!line.productId) continue;
    const qty = openQuantity(line);
    if (qty > 0n) open.set(line.productId, (open.get(line.productId) ?? 0n) + qty);
  }
  const result = new Map<string, bigint>();
  for (const [productId, qty] of open) {
    const left = qty - (pendingOutput.get(productId) ?? 0n);
    if (left > 0n) result.set(productId, left);
  }
  return result;
}

const ALLOCATING_STATES = ["confirmed", "in_production", "ready_to_ship"];

/** Aparta la existencia disponible para lo que le falta al pedido. */
export async function allocateOrder(db: Db, tenant: TenantActor, order: OrderRow, options: { force?: boolean } = {}) {
  if (!options.force && !ALLOCATING_STATES.includes(order.status)) {
    return { allocated: [] as Array<{ lineId: string; quantity: string }> };
  }
  const lines = await loadOrderLines(db, order.id);
  const supply = await orderSupply(db, lines);
  const locationId = await orderLocation(db, order);
  const available = new Map<string, bigint>();
  for (const line of supply) {
    if (!line.stocked || !line.productId || available.has(line.productId)) continue;
    const source = lines.find((row) => row.id === line.lineId) as OrderLineRow;
    available.set(line.productId, await availableAt(db, source.filamentId ? { filamentId: source.filamentId } : { productId: source.productId }, locationId));
  }
  const allocated: Array<{ lineId: string; quantity: string }> = [];
  for (const item of planOrderAllocation(supply, available)) {
    if (item.reserve === 0n) continue;
    const line = lines.find((row) => row.id === item.lineId) as OrderLineRow;
    await reserveStock(db, tenant, {
      ...(line.filamentId ? { filamentId: line.filamentId } : { productId: line.productId }),
      locationId,
      quantity: item.reserve,
      reason: `Apartado para ${order.folio}`,
      reference: { type: "sales_order", id: order.id },
    });
    await db
      .update(salesOrderLines)
      .set({ reservedQty: formatQty(qtyFromDb(line.reservedQty) + item.reserve) })
      .where(eq(salesOrderLines.id, line.id));
    allocated.push({ lineId: line.id, quantity: formatQty(item.reserve) });
  }
  return { allocated };
}

export async function releaseOrderReservations(db: Db, tenant: TenantActor, order: OrderRow, reason: string) {
  const lines = await loadOrderLines(db, order.id);
  const locationId = await orderLocation(db, order);
  for (const line of lines) {
    const reserved = qtyFromDb(line.reservedQty);
    if (reserved <= 0n || !(line.productId || line.filamentId)) continue;
    await reserveStock(db, tenant, {
      ...(line.filamentId ? { filamentId: line.filamentId } : { productId: line.productId }),
      locationId,
      quantity: -reserved,
      reason: `${reason} ${order.folio}`,
      reference: { type: "sales_order", id: order.id },
    });
    await db.update(salesOrderLines).set({ reservedQty: "0" }).where(eq(salesOrderLines.id, line.id));
  }
}

/** Mueve el pedido abierto al estado que le toca según lo apartado y lo que hay en producción. */
export async function syncOrderState(db: Db, tenant: TenantActor, orderId: string): Promise<OrderRow> {
  const order = await loadOrder(db, orderId);
  const supply = await orderSupply(db, await loadOrderLines(db, order.id));
  const production = await productionFor(db, order.id);
  const current = order.status as SalesOrderState;
  const target = syncedOrderState(current, { fullyAllocated: isFullyAllocated(supply), openProduction: production.open });
  let fulfillment = order.fulfillmentStatus as FulfillmentState;
  if (target === "ready_to_ship" && fulfillment === "pending") fulfillment = "ready";
  if (target !== "ready_to_ship" && ["ready", "picking", "packing"].includes(fulfillment)) fulfillment = "pending";
  if (target === current && fulfillment === order.fulfillmentStatus) return order;
  const status = target === current ? current : unwrap(transitionSalesOrder(current, target));
  const nextFulfillment = unwrap(transitionFulfillment(order.fulfillmentStatus as FulfillmentState, fulfillment));
  const [row] = await db
    .update(salesOrders)
    .set({ status, fulfillmentStatus: nextFulfillment, updatedAt: new Date() })
    .where(eq(salesOrders.id, order.id))
    .returning();
  if (status !== current) {
    await audit(db, tenant, "sales_order.status_synced", "sales_order", order.id, { from: current, to: status });
    await orderEvent(db, tenant, order.id, "status_synced", { from: current, to: status });
  }
  return row;
}

/** Historial del pedido visible para todo el equipo (la bitácora de auditoría es solo para administradores). */
export async function orderEvent(
  db: Db,
  tenant: TenantActor,
  orderId: string,
  kind: string,
  detail: { from?: string | null; to?: string | null; note?: string | null } = {},
) {
  await db.insert(salesOrderEvents).values({
    tenantId: tenant.tenantId,
    salesOrderId: orderId,
    kind,
    fromStatus: detail.from ?? null,
    toStatus: detail.to ?? null,
    note: detail.note ?? null,
    createdBy: tenant.userId,
  });
}

/** Aparta y acomoda el estado del pedido de una OP que acaba de entregar terminado. */
export async function fulfillLinkedOrder(db: Db, tenant: TenantActor, salesOrderId: string | null) {
  if (!salesOrderId) return;
  const order = await loadOrder(db, salesOrderId);
  if (!ALLOCATING_STATES.includes(order.status)) return;
  await allocateOrder(db, tenant, order);
  await syncOrderState(db, tenant, order.id);
}

export async function activePrefactura(db: Db, orderId: string) {
  const [document] = await db
    .select({ id: commercialDocuments.id, series: commercialDocuments.series, folio: commercialDocuments.folio })
    .from(commercialDocuments)
    .where(and(eq(commercialDocuments.salesOrderId, orderId), eq(commercialDocuments.status, "issued")))
    .limit(1);
  return document ?? null;
}

async function printsOpen(db: Db, orderId: string, lines: OrderLineRow[]): Promise<boolean> {
  const prints = await db
    .select({ resolution: salesOrderPrints.resolution })
    .from(salesOrderPrints)
    .where(eq(salesOrderPrints.salesOrderId, orderId));
  const printPending = prints.some((print) => !serviceIsSettled(print.resolution));
  const looseService = lines.some((line) => line.lineKind === "service" && !line.printId && !serviceIsSettled(line.resolution));
  return printPending || looseService;
}

export async function orderLedger(db: Db, orderId: string): Promise<PaymentRow[]> {
  return db.select().from(payments).where(eq(payments.salesOrderId, orderId));
}

export function paidMinor(totalMinor: bigint, ledger: PaymentRow[]): bigint {
  return BigInt(totalMinor) - dueMinor(BigInt(totalMinor), ledger);
}

export async function orderContext(db: Db, tenant: TenantActor, order: OrderRow): Promise<OrderContext> {
  const lines = await loadOrderLines(db, order.id);
  const supply = await orderSupply(db, lines);
  const production = await productionFor(db, order.id);
  const shortage = uncoveredShortage(supply, production.pendingOutput);
  const makeable = await manufacturableIds(db, [...shortage.keys()]);
  const ledger = await orderLedger(db, order.id);
  const due = dueMinor(BigInt(order.totalMinor), ledger);
  return {
    state: order.status as SalesOrderState,
    fulfillment: order.fulfillmentStatus as FulfillmentState,
    role: tenant.role,
    fullyAllocated: isFullyAllocated(supply),
    makeableShortage: [...shortage.keys()].some((id) => makeable.has(id)),
    hasDeliverable: supply.some((line) => line.stocked && line.reserved + line.shipped > 0n),
    openProduction: production.open,
    startedProduction: production.started,
    activePrefactura: Boolean(await activePrefactura(db, order.id)),
    paidMinor: BigInt(order.totalMinor) - due,
    amountDueMinor: due,
    servicesOpen: await printsOpen(db, order.id, lines),
    articlesPrestados: await articlesArePrestados(db, order.id, lines),
  };
}

async function articlesArePrestados(db: Db, orderId: string, lines: OrderLineRow[]): Promise<boolean> {
  const prints = await db
    .select({ resolution: salesOrderPrints.resolution })
    .from(salesOrderPrints)
    .where(eq(salesOrderPrints.salesOrderId, orderId));
  if (prints.some((print) => !isPrestado(print.resolution))) return false;
  const finished = new Set<string>();
  for (const line of lines) {
    if (line.printId || line.lineKind !== "product" || !line.productId || finished.has(line.productId)) continue;
    const [product] = await db.select({ productType: products.productType }).from(products).where(eq(products.id, line.productId)).limit(1);
    if (product?.productType === "finished_good") finished.add(line.productId);
  }
  return lines.every((line) => {
    if (line.printId || !line.productId || !finished.has(line.productId)) return true;
    return isPrestado(line.resolution);
  });
}

async function normalizeCommercialLines(
  db: Db,
  lines: PricedLineInput[],
  allowInactive = false,
): Promise<PricedLineInput[]> {
  const normalized: PricedLineInput[] = [];
  for (const line of lines) {
    const targets = [line.productId, line.filamentId, line.serviceId].filter(Boolean);
    if (targets.length !== 1) {
      throw new AppError("line_target", "Cada partida es un producto, un filamento o un servicio.");
    }
    if (line.serviceId) {
      const service = await one(db, serviceOfferings, serviceOfferings.id, line.serviceId, "No encontramos ese servicio.");
      if (!allowInactive && service.status !== "active") {
        throw new AppError("service_inactive", "Ese servicio no está disponible.", 409);
      }
      normalized.push({
        ...line,
        productId: null,
        filamentId: null,
        serviceId: service.id,
        sku: service.code,
        lineKind: "service",
        uom: saleUom("service", service.unit),
        terms: line.terms?.trim() ? line.terms.trim() : service.terms,
      });
      continue;
    }
    if (line.filamentId || line.productId) {
      const requested = (line.filamentId ?? line.productId) as string;
      const [filament] = await db.select().from(filaments).where(eq(filaments.id, requested)).limit(1);
      if (filament) {
        if (!allowInactive && filament.status !== "active") {
          throw new AppError("product_inactive", "Ese filamento no está disponible.", 409);
        }
        normalized.push({
          ...line,
          productId: null,
          filamentId: filament.id,
          serviceId: null,
          sku: filament.sku,
          lineKind: "filament",
          uom: "g",
          terms: null,
        });
        continue;
      }
    }
    const product = await one(db, products, products.id, line.productId as string, "No encontramos ese producto.");
    if (product.productType === "service") {
      throw new AppError("use_service_catalog", "Los servicios se capturan en el catálogo de servicios.", 409);
    }
    if (product.productType === "raw_material") {
      throw new AppError("use_filament_catalog", "Los filamentos se capturan en el catálogo de filamentos.", 409);
    }
    if (!allowInactive && product.status !== "active") {
      throw new AppError("product_inactive", "Ese producto no está disponible.", 409);
    }
    normalized.push({
      ...line,
      productId: product.id,
      filamentId: null,
      serviceId: null,
      sku: product.sku,
      lineKind: "product",
      uom: saleUom("product", product.stockUom),
      terms: null,
    });
  }
  return normalized;
}

export async function priceLines(
  db: Db,
  lines: PricedLineInput[],
  globalDiscount: string | undefined,
  shipping: string,
  allowInactive = false,
) {
  const normalized = await normalizeCommercialLines(db, lines, allowInactive);
  const [company] = await db.select().from(companyProfiles).limit(1);
  const rate = company?.defaultVatRate ? String(company.defaultVatRate) : "0.16";
  const taxLines = normalized.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    taxable: true,
  }));
  const shippingMoney = Money.fromMajor(shipping || "0");
  if (shippingMoney.minor > 0n) {
    taxLines.push({ description: "Envío", quantity: "1", unitPrice: shippingMoney.toMajor(), discount: "0", taxable: true });
  }
  const priced = calculateMxTax({ lines: taxLines, globalDiscount, rate });
  const stored = normalized.map((line, index) => {
    const result = priced.lines[index];
    if (!result) throw new AppError("empty_lines", "Agrega al menos una línea.");
    return {
      productId: line.productId ?? null,
      filamentId: line.filamentId ?? null,
      serviceId: line.serviceId ?? null,
      sku: line.sku ?? "",
      lineKind: line.lineKind ?? "product",
      terms: line.terms ?? null,
      uom: line.uom ?? "pza",
      description: line.description,
      quantity: formatQty(parseQty(line.quantity)),
      unitPriceMinor: Money.fromMajor(line.unitPrice).minor,
      discountMinor: Money.fromMajor(line.discount ?? "0").minor,
      netMinor: Money.fromMajor(result.net).minor,
      vatMinor: Money.fromMajor(result.tax).minor,
      totalMinor: Money.fromMajor(result.total).minor,
    };
  });
  return { ...priced, stored };
}

/** Descuento de la línea proporcional a la cantidad vigente; `discountMinor` corresponde a lo pedido. */
export function effectiveLineDiscount(line: Pick<OrderLineRow, "quantity" | "closedShortQty" | "discountMinor">): bigint {
  const ordered = qtyFromDb(line.quantity);
  if (ordered <= 0n) return 0n;
  return (BigInt(line.discountMinor) * effectiveQty(line)) / ordered;
}

/** Descuento global del pedido: el total de descuentos menos los de cada línea. */
export function globalDiscountMinor(order: Pick<OrderRow, "discountMinor">, lines: OrderLineRow[]): bigint {
  const perLine = lines.reduce((sum, line) => sum + effectiveLineDiscount(line), 0n);
  return maxQty(0n, BigInt(order.discountMinor) - perLine);
}

function saleUom(lineKind: string, raw: string): string {
  if (lineKind === "filament" || raw === "G") return "g";
  if (raw === "EA") return "pza";
  return raw;
}

function lineBase(line: OrderLineRow): bigint {
  const gross = Money.fromMinor(BigInt(line.unitPriceMinor)).timesQuantity(formatQty(effectiveQty(line))).minor;
  return gross - effectiveLineDiscount(line);
}

/**
 * Recalcula importes después de cerrar cantidades: cada línea cobra lo vigente y el descuento
 * global se reduce en la misma proporción que la base.
 */
export async function repriceOrder(db: Db, order: OrderRow, before: OrderLineRow[], after: OrderLineRow[]) {
  const shipping = BigInt(order.shippingMinor);
  const baseBefore = before.reduce((sum, line) => sum + lineBase(line), 0n) + shipping;
  const baseAfter = after.reduce((sum, line) => sum + lineBase(line), 0n) + shipping;
  const global = globalDiscountMinor(order, before);
  const newGlobal = baseBefore > 0n ? (global * baseAfter) / baseBefore : 0n;
  const kept = after.filter((line) => effectiveQty(line) > 0n);
  const priced = await priceLines(
    db,
    kept.map((line) => ({
      productId: line.productId,
      filamentId: line.filamentId,
      serviceId: line.serviceId,
      terms: line.terms,
      description: line.description,
      quantity: formatQty(effectiveQty(line)),
      unitPrice: Money.fromMinor(BigInt(line.unitPriceMinor)).toMajor(),
      discount: Money.fromMinor(effectiveLineDiscount(line)).toMajor(),
    })),
    Money.fromMinor(newGlobal).toMajor(),
    Money.fromMinor(shipping).toMajor(),
    true,
  );
  for (const line of after) {
    const index = kept.indexOf(line);
    const stored = index >= 0 ? priced.stored[index] : undefined;
    await db
      .update(salesOrderLines)
      .set({
        netMinor: stored?.netMinor ?? 0n,
        vatMinor: stored?.vatMinor ?? 0n,
        totalMinor: stored?.totalMinor ?? 0n,
      })
      .where(eq(salesOrderLines.id, line.id));
  }
  const [row] = await db
    .update(salesOrders)
    .set({
      subtotalMinor: Money.fromMajor(priced.subtotal).minor,
      discountMinor: Money.fromMajor(priced.discount).minor,
      vatMinor: Money.fromMajor(priced.tax).minor,
      totalMinor: Money.fromMajor(priced.total).minor,
      updatedAt: new Date(),
    })
    .where(eq(salesOrders.id, order.id))
    .returning();
  return row as OrderRow;
}

export function dueMinor(totalMinor: bigint, ledger: PaymentRow[]): bigint {
  return amountDue(
    Money.fromMinor(BigInt(totalMinor)),
    ledger.map((entry) => ({
      status: entry.status as "pending" | "completed" | "failed" | "voided",
      kind: entry.kind as "payment" | "refund",
      amount: Money.fromMinor(BigInt(entry.amountMinor)),
    })),
  ).minor;
}

export async function refreshPaymentStatus(db: Db, orderId: string, totalMinor: bigint) {
  const ledger = await orderLedger(db, orderId);
  const due = dueMinor(totalMinor, ledger);
  const paymentStatus = due <= 0n ? "paid" : due < totalMinor ? "partial" : "pending";
  await db.update(salesOrders).set({ paymentStatus }).where(eq(salesOrders.id, orderId));
}

export async function assertCredit(
  db: Db,
  tenant: TenantActor,
  order: Pick<OrderRow, "id" | "customerId" | "totalMinor" | "creditOverrideReason">,
  reason: string | undefined,
): Promise<string | null> {
  const customer = await one(db, customers, customers.id, order.customerId, "No encontramos ese cliente.");
  if (customer.paymentTerms === "pue") return order.creditOverrideReason;
  const open = await db.select().from(salesOrders).where(eq(salesOrders.customerId, customer.id));
  const exposure = open
    .filter((row: OrderRow) => row.id !== order.id && !["cancelled", "draft"].includes(row.status) && row.paymentStatus !== "paid")
    .reduce((sum: bigint, row: OrderRow) => sum + BigInt(row.totalMinor), 0n);
  if (!exceedsCredit(BigInt(customer.creditLimitMinor), exposure, BigInt(order.totalMinor))) {
    return order.creditOverrideReason;
  }
  if (!reason || !canOverrideCredit(tenant.role)) {
    throw new AppError(
      "credit_limit",
      "El pedido supera el límite de crédito. Un administrador puede autorizarlo con un motivo.",
      409,
    );
  }
  await db.insert(auditEvents).values({
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    action: "credit.override",
    entityType: "sales_order",
    entityId: order.id,
    metadata: { reason },
  });
  return reason;
}

function money(value: bigint | number | string, role: TenantRole): string | null {
  if (!canReadSalePrice(role)) return null;
  return Money.fromMinor(BigInt(value)).toMajor();
}

export function mapOrder(row: OrderRow, role: TenantRole) {
  return {
    id: row.id,
    folio: row.folio,
    quoteId: row.quoteId,
    customerId: row.customerId,
    customerName: row.customerName,
    customerRfc: row.customerRfc,
    status: row.status,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    subtotal: money(row.subtotalMinor, role),
    discount: money(row.discountMinor, role),
    vat: money(row.vatMinor, role),
    shipping: money(row.shippingMinor, role),
    total: money(row.totalMinor, role),
    currency: "MXN",
    locationId: row.locationId ?? null,
    promisedDate: row.promisedDate ?? null,
    shipTo: row.shipTo ?? null,
    carrier: row.carrier ?? null,
    trackingNumber: row.trackingNumber ?? null,
    shipmentFolio: row.shipmentFolio ?? null,
    shippedAt: isoDate(row.shippedAt),
    deliveredAt: isoDate(row.deliveredAt),
    holdReason: row.holdReason ?? null,
    cancelReason: row.cancelReason ?? null,
    closedShortReason: row.closedShortReason ?? null,
    notes: row.notes ?? null,
    serviceTerms: row.serviceTerms ?? null,
    ...paymentConditions(row.paymentTerms, row.depositPercent ?? 0, row.paymentNotes ?? null, BigInt(row.totalMinor), role),
    createdAt: isoDate(row.createdAt),
  };
}

export function depositSplit(totalMinor: bigint, depositPercent: number) {
  const deposit = roundDiv(totalMinor * BigInt(depositPercent), 100n);
  return { deposit, balance: totalMinor - deposit };
}

export function paymentConditions(
  paymentTerms: string | null,
  depositPercent: number,
  paymentNotes: string | null,
  totalMinor: bigint,
  role: TenantRole,
) {
  const split = depositSplit(totalMinor, depositPercent);
  return {
    paymentTerms,
    depositPercent,
    paymentNotes,
    deposit: money(split.deposit, role),
    balance: money(split.balance, role),
  };
}

/** Suma días hábiles (lunes a viernes) a la fecha de hoy en la Ciudad de México. */
export function addBusinessDays(days: number, from = new Date()): string {
  const cursor = new Date(`${from.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

export function withDue(order: OrderRow, ledger: PaymentRow[], role: TenantRole) {
  const due = dueMinor(BigInt(order.totalMinor), ledger.filter((entry) => entry.salesOrderId === order.id || entry.orderId === order.id));
  return { ...mapOrder(order, role), amountDue: money(due, role) };
}

export function mapOrderLine(line: OrderLineRow, role: TenantRole) {
  return {
    id: line.id,
    printId: line.printId,
    productId: line.productId,
    serviceId: line.serviceId,
    lineKind: line.lineKind,
    terms: line.terms,
    resolution: line.resolution,
    resolutionNote: line.resolutionNote,
    description: line.description,
    quantity: formatQty(qtyFromDb(line.quantity)),
    effectiveQuantity: formatQty(effectiveQty(line)),
    closedShort: formatQty(qtyFromDb(line.closedShortQty ?? "0")),
    reserved: formatQty(qtyFromDb(line.reservedQty ?? "0")),
    shipped: formatQty(qtyFromDb(line.shippedQty ?? "0")),
    unitPrice: money(line.unitPriceMinor, role),
    discount: money(line.discountMinor, role),
    net: money(line.netMinor, role),
    vat: money(line.vatMinor, role),
    total: money(line.totalMinor, role),
  };
}

export function mapPayment(row: PaymentRow, role: TenantRole) {
  return {
    id: row.id,
    orderId: row.orderId ?? row.salesOrderId,
    folio: row.folio ?? "",
    method: row.method,
    kind: row.kind,
    status: row.status,
    amount: money(row.amountMinor, role),
    reference: row.reference,
    note: row.note,
    createdAt: row.createdAt,
  };
}
