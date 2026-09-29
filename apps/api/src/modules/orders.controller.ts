import { Body, Controller, Get, Header, Headers, Param, Patch, Post, Put, Query, StreamableFile } from "@nestjs/common";
import {
  assertOrderAction,
  canReadSalePrice,
  closeShortPlan,
  formatQty,
  isFullyAllocated,
  Money,
  openQuantity,
  orderActions,
  qtyFromDb,
  resumeTarget,
  transitionFulfillment,
  transitionSalesOrder,
  transitionServiceResolution,
  SERVICE_RESOLUTIONS,
  type ServiceResolution,
  type FulfillmentState,
  type OrderAction,
  type SalesOrderState,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  commercialDocuments,
  companyProfiles,
  customerAddresses,
  customers,
  locations,
  payments,
  productionOrders,
  products,
  salesOrderEvents,
  salesOrderLines,
  salesOrders,
  serviceOfferings,
} from "../db/schema";
import { renderQuotePdf } from "./quote-pdf";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import {
  allocateOrder,
  assertCredit,
  dueMinor,
  globalDiscountMinor,
  loadOrder,
  loadOrderLines,
  mapOrder,
  mapOrderLine,
  mapPayment,
  orderContext,
  orderEvent,
  orderLedger,
  orderLocation,
  orderSupply,
  paidMinor,
  priceLines,
  productionFor,
  refreshPaymentStatus,
  releaseOrderReservations,
  repriceOrder,
  SALES_ROLES,
  SHIPPER_ROLES,
  syncOrderState,
  withDue,
  type OrderLineRow,
  type OrderRow,
  type PaymentRow,
} from "./orders.shared";
import { allocateFolio, audit, isoDate, one, postStock, unwrap, withIdempotency, type Db } from "./support";

const lineSchema = z
  .object({
    productId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    description: z.string().trim().min(1).max(180),
    quantity: z.string(),
    unitPrice: z.string(),
    discount: z.string().optional(),
    terms: z.string().trim().max(1000).optional(),
  })
  .refine((line) => Boolean(line.productId) !== Boolean(line.serviceId), {
    message: "Cada partida es un producto o un servicio.",
  });

const shipToSchema = z.object({
  name: z.string().trim().max(120).optional(),
  line1: z.string().trim().min(1).max(160),
  neighborhood: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().regex(/^\d{5}$/),
  state: z.string().trim().max(40),
  phone: z.string().trim().max(20).optional(),
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  customerId: z.string().uuid(),
  globalDiscount: z.string().optional(),
  shipping: z.string().optional(),
  serviceTerms: z.string().trim().max(2000).optional(),
  lines: z.array(lineSchema).min(1).max(100),
  locationId: z.string().uuid().optional(),
  promisedDate: dateSchema.optional(),
  shipTo: shipToSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

const editLinesSchema = z.object({
  globalDiscount: z.string().optional(),
  shipping: z.string().optional(),
  lines: z.array(lineSchema).min(1).max(100),
  locationId: z.string().uuid().optional(),
  creditOverrideReason: z.string().trim().min(3).max(180).optional(),
});

const detailsSchema = z.object({
  promisedDate: dateSchema.nullable().optional(),
  shipTo: shipToSchema.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(200) });
const shipSchema = z.object({
  carrier: z.string().trim().min(1).max(60),
  trackingNumber: z.string().trim().max(80).optional(),
});

const LIVE_STATES = ["draft", "pending", "confirmed", "in_production", "ready_to_ship", "on_hold"];
const SHIPMENT_STATES = ["ready_to_ship", "shipped", "delivered", "completed"];

@Controller()
export class OrdersController {
  private get database() {
    return services().database;
  }

  @Get("orders")
  async list(@CurrentUser() actor: Actor, @Query("status") status?: string) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, async (db) => {
      const orders = await db
        .select()
        .from(salesOrders)
        .where(status ? inArray(salesOrders.status, status.split(",")) : undefined)
        .orderBy(desc(salesOrders.createdAt));
      const ledger = await db.select().from(payments);
      return orders.map((order: OrderRow) => withDue(order, ledger, tenant.role));
    });
    return { data: rows };
  }

  @Get("orders/:id")
  async get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, (db) => orderDetail(db, tenant, id));
  }

  @Get("orders/:id/pdf")
  @Header("Content-Type", "application/pdf")
  async pdf(@CurrentUser() actor: Actor, @Param("id") id: string): Promise<StreamableFile> {
    const tenant = requireTenant(actor);
    const file = await this.database.asUser(tenant, async (db) => {
      const order = await orderDetail(db, tenant, id);
      const [company] = await db.select().from(companyProfiles).limit(1);
      const [customer] = await db.select({ paymentTerms: customers.paymentTerms }).from(customers).where(eq(customers.id, order.customerId)).limit(1);
      const issued = new Date(order.createdAt ?? Date.now());
      const bytes = renderQuotePdf({
        title: "PEDIDO",
        kindLabel: "Pedido",
        dateLabel: order.promisedDate ? "Entrega" : "Fecha",
        folio: order.folio,
        issuedAt: issued.toLocaleDateString("es-MX"),
        customerName: order.customerName,
        customerRfc: order.customerRfc,
        paymentTerms: paymentTermsLabel(customer?.paymentTerms ?? "pue"),
        validUntil: order.promisedDate ?? issued.toLocaleDateString("es-MX"),
        mode: "products",
        serviceTerms: order.serviceTerms,
        subtotal: order.subtotal,
        discount: order.discount,
        vat: order.vat,
        vatRate: company ? String(company.defaultVatRate) : "0.1600",
        total: order.total,
        currency: order.currency,
        issuer: company?.tradeName || company?.legalName || "Taller",
        issuerRfc: company?.rfc ?? "—",
        issuerRegime: company?.taxRegime ?? "—",
        issuerPostalCode: company?.fiscalPostalCode ?? "—",
        prints: [],
        lines: order.lines.map((line) => ({
          description: line.description,
          terms: line.terms,
          uom: line.uom,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          net: line.net,
          vat: line.vat,
          total: line.total,
        })),
      });
      return { filename: `${order.folio}.pdf`, bytes };
    });
    return new StreamableFile(Buffer.from(file.bytes), {
      type: "application/pdf",
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Get("shipments")
  async shipments(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select()
        .from(salesOrders)
        .where(or(inArray(salesOrders.status, SHIPMENT_STATES), isNotNull(salesOrders.shipmentFolio)))
        .orderBy(asc(salesOrders.promisedDate), desc(salesOrders.createdAt)),
    );
    return {
      data: rows.map((row: OrderRow) => ({
        id: row.id,
        folio: row.folio,
        customerName: row.customerName,
        status: row.status,
        fulfillmentStatus: row.fulfillmentStatus,
        shipmentFolio: row.shipmentFolio,
        carrier: row.carrier,
        trackingNumber: row.trackingNumber,
        promisedDate: row.promisedDate,
        shipTo: row.shipTo ?? null,
        shippedAt: isoDate(row.shippedAt),
        deliveredAt: isoDate(row.deliveredAt),
      })),
    };
  }

  @Post("orders")
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SALES_ROLES]);
    const input = createSchema.parse(body);
    const folio = await allocateFolio(this.database, tenant.tenantId, "order", "PED");
    const order = await this.database.asUser(tenant, async (db) => {
      const customer = await one(db, customers, customers.id, input.customerId, "No encontramos ese cliente.");
      if (customer.status !== "active") throw new AppError("customer_inactive", "Ese cliente no puede comprar.", 409);
      if (input.locationId) await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.");
      const priced = await priceLines(db, input.lines, input.globalDiscount, input.shipping ?? "0");
      const [created] = await db
        .insert(salesOrders)
        .values({
          tenantId: tenant.tenantId,
          folio: `PED-${folio}`,
          customerId: customer.id,
          customerName: customer.legalName,
          customerRfc: customer.rfc,
          subtotalMinor: Money.fromMajor(priced.subtotal).minor,
          discountMinor: Money.fromMajor(priced.discount).minor,
          shippingMinor: Money.fromMajor(input.shipping ?? "0").minor,
          vatMinor: Money.fromMajor(priced.tax).minor,
          totalMinor: Money.fromMajor(priced.total).minor,
          locationId: input.locationId ?? null,
          promisedDate: input.promisedDate ?? null,
          shipTo: input.shipTo ?? (await defaultShipTo(db, customer.id)),
          notes: input.notes ?? null,
          serviceTerms: input.serviceTerms || null,
          createdBy: tenant.userId,
        })
        .returning();
      await db.insert(salesOrderLines).values(
        priced.stored.map(({ uom: _uom, sku: _sku, ...line }, position) => ({
          ...line,
          position,
          tenantId: tenant.tenantId,
          salesOrderId: created.id,
        })),
      );
      await orderEvent(db, tenant, created.id, "created", { to: created.status });
      return created;
    });
    return mapOrder(order, tenant.role);
  }

  @Patch("orders/:id")
  async updateDetails(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SALES_ROLES]);
    const input = detailsSchema.parse(body);
    return this.database.asUser(tenant, async (db) => {
      const order = await loadOrder(db, id);
      if (!LIVE_STATES.includes(order.status)) {
        throw new AppError("order_action_blocked", "El pedido ya se embarcó o se cerró; ya no se cambia.", 409);
      }
      await db
        .update(salesOrders)
        .set({
          ...(input.promisedDate !== undefined ? { promisedDate: input.promisedDate } : {}),
          ...(input.shipTo !== undefined ? { shipTo: input.shipTo } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, order.id));
      await orderEvent(db, tenant, order.id, "details_updated");
      return orderDetail(db, tenant, order.id);
    });
  }

  @Put("orders/:id/lines")
  async editLines(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SALES_ROLES]);
    const input = editLinesSchema.parse(body);
    return this.database.asUser(tenant, async (db) => {
      const order = await loadOrder(db, id);
      assertOrderAction(await orderContext(db, tenant, order), "edit");
      if (input.locationId) await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.");
      const priced = await priceLines(db, input.lines, input.globalDiscount, input.shipping ?? "0");
      const total = Money.fromMajor(priced.total).minor;
      const paid = paidMinor(BigInt(order.totalMinor), await orderLedger(db, order.id));
      if (total < paid) {
        throw new AppError(
          "total_below_paid",
          "El nuevo total queda debajo de lo cobrado. Registra el reembolso primero.",
          409,
        );
      }
      await releaseOrderReservations(db, tenant, order, "Edición de");
      await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, order.id));
      await db.insert(salesOrderLines).values(
        priced.stored.map(({ uom: _uom, sku: _sku, ...line }, position) => ({
          ...line,
          position,
          tenantId: tenant.tenantId,
          salesOrderId: order.id,
        })),
      );
      const [updated] = await db
        .update(salesOrders)
        .set({
          subtotalMinor: Money.fromMajor(priced.subtotal).minor,
          discountMinor: Money.fromMajor(priced.discount).minor,
          shippingMinor: Money.fromMajor(input.shipping ?? "0").minor,
          vatMinor: Money.fromMajor(priced.tax).minor,
          totalMinor: total,
          ...(input.locationId ? { locationId: input.locationId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, order.id))
        .returning();
      if (["confirmed", "ready_to_ship"].includes(updated.status)) {
        const override = await assertCredit(db, tenant, updated, input.creditOverrideReason);
        if (override !== updated.creditOverrideReason) {
          await db.update(salesOrders).set({ creditOverrideReason: override }).where(eq(salesOrders.id, order.id));
        }
        await allocateOrder(db, tenant, updated);
        await syncOrderState(db, tenant, order.id);
      }
      await refreshPaymentStatus(db, order.id, total);
      await orderEvent(db, tenant, order.id, "edited", {
        note: `Total ${Money.fromMinor(BigInt(order.totalMinor)).toMajor()} → ${Money.fromMinor(total).toMajor()}`,
      });
      await audit(db, tenant, "sales_order.edited", "sales_order", order.id, { lines: input.lines.length });
      return orderDetail(db, tenant, order.id);
    });
  }

  @Post("orders/:id/submit")
  async submit(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "submit", async (db, tenant, order) => {
      await setStatus(db, tenant, order, "pending", "submitted");
    });
  }

  @Post("orders/:id/confirm")
  async confirm(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ creditOverrideReason: z.string().trim().min(3).max(180).optional() }).parse(body ?? {});
    return this.step(actor, id, "confirm", async (db, tenant, order) => {
      const override = await assertCredit(db, tenant, order, input.creditOverrideReason);
      const locationId = await orderLocation(db, order);
      const shipTo = order.shipTo ?? (await defaultShipTo(db, order.customerId));
      await db
        .update(salesOrders)
        .set({ creditOverrideReason: override, locationId, shipTo })
        .where(eq(salesOrders.id, order.id));
      const confirmed = await setStatus(db, tenant, order, "confirmed", "confirmed");
      await allocateOrder(db, tenant, confirmed);
      await syncOrderState(db, tenant, order.id);
    });
  }

  @Post("orders/:id/allocate")
  async allocate(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "allocate", async (db, tenant, order) => {
      const { allocated } = await allocateOrder(db, tenant, order);
      if (!allocated.length) {
        throw new AppError("nothing_available", "No hay existencia libre para apartar.", 409);
      }
      await orderEvent(db, tenant, order.id, "allocated", { note: `${allocated.length} línea(s)` });
      await syncOrderState(db, tenant, order.id);
    });
  }

  @Post("orders/:id/hold")
  async hold(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const { reason } = reasonSchema.parse(body);
    return this.step(actor, id, "hold", async (db, tenant, order) => {
      await db.update(salesOrders).set({ holdReason: reason }).where(eq(salesOrders.id, order.id));
      await setStatus(db, tenant, order, "on_hold", "held", reason);
    });
  }

  @Post("orders/:id/resume")
  async resume(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "resume", async (db, tenant, order) => {
      await allocateOrder(db, tenant, order, { force: true });
      const supply = await orderSupply(db, await loadOrderLines(db, order.id));
      const production = await productionFor(db, order.id);
      const target = resumeTarget({ fullyAllocated: isFullyAllocated(supply), openProduction: production.open });
      await db.update(salesOrders).set({ holdReason: null }).where(eq(salesOrders.id, order.id));
      await setStatus(db, tenant, order, target, "resumed");
      await syncOrderState(db, tenant, order.id);
    });
  }

  @Post("orders/:id/cancel")
  async cancel(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const { reason } = reasonSchema.parse(body);
    return this.step(actor, id, "cancel", async (db, tenant, order) => {
      await releaseOrderReservations(db, tenant, order, "Cancelación de");
      await db
        .update(payments)
        .set({ status: "voided" })
        .where(and(eq(payments.salesOrderId, order.id), eq(payments.status, "pending")));
      await db
        .update(salesOrders)
        .set({ cancelReason: reason, paymentStatus: "cancelled", fulfillmentStatus: "pending" })
        .where(eq(salesOrders.id, order.id));
      await setStatus(db, tenant, order, "cancelled", "cancelled", reason);
    });
  }

  @Post("orders/:id/close-short")
  async closeShort(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const { reason } = reasonSchema.parse(body);
    return this.step(actor, id, "close_short", async (db, tenant, order) => {
      const before = await loadOrderLines(db, order.id);
      const plan = unwrap(closeShortPlan(await orderSupply(db, before)));
      for (const item of plan) {
        const line = before.find((row) => row.id === item.lineId) as OrderLineRow;
        await db
          .update(salesOrderLines)
          .set({ closedShortQty: formatQty(qtyFromDb(line.closedShortQty) + item.close) })
          .where(eq(salesOrderLines.id, line.id));
      }
      const after = await loadOrderLines(db, order.id);
      const repriced = await repriceOrder(db, order, before, after);
      await db.update(salesOrders).set({ closedShortReason: reason }).where(eq(salesOrders.id, order.id));
      await refreshPaymentStatus(db, order.id, BigInt(repriced.totalMinor));
      await orderEvent(db, tenant, order.id, "closed_short", {
        note: `${reason} · Total ${Money.fromMinor(BigInt(order.totalMinor)).toMajor()} → ${Money.fromMinor(BigInt(repriced.totalMinor)).toMajor()}`,
      });
      await audit(db, tenant, "sales_order.closed_short", "sales_order", order.id, {
        reason,
        lines: plan.map((item) => ({ lineId: item.lineId, closed: formatQty(item.close) })),
      });
      await syncOrderState(db, tenant, order.id);
    });
  }

  @Post("orders/:id/pick")
  async pick(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "pick", (db, tenant, order) => setFulfillment(db, tenant, order, "picking"));
  }

  @Post("orders/:id/pack")
  async pack(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "pack", (db, tenant, order) => setFulfillment(db, tenant, order, "packing"));
  }

  @Post("orders/:id/ship")
  async ship(
    @CurrentUser() actor: Actor,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenant = assertRole(actor, [...SHIPPER_ROLES]);
    if (!idempotencyKey) {
      throw new AppError("idempotency_key_required", "Falta la llave de idempotencia del embarque.");
    }
    const input = shipSchema.parse(body);
    return withIdempotency(this.database, tenant.userId, idempotencyKey, { route: "orders.ship", id, input }, async () => {
      await this.database.asUser(tenant, async (db) => {
        assertOrderAction(await orderContext(db, tenant, await loadOrder(db, id)), "ship");
      });
      const folio = await allocateFolio(this.database, tenant.tenantId, "shipment", "EMB");
      return this.step(actor, id, "ship", async (db, tenant, order) => {
        const lines = await loadOrderLines(db, order.id);
        const locationId = await orderLocation(db, order);
        for (const line of lines) {
          const reserved = qtyFromDb(line.reservedQty);
          if (reserved <= 0n || !(line.productId || line.filamentId)) continue;
          await postStock(db, tenant, {
            ...(line.filamentId ? { filamentId: line.filamentId } : { productId: line.productId }),
            locationId,
            kind: "issue",
            delta: -reserved,
            releaseAllocated: reserved,
            allowNegative: false,
            reason: `Embarque EMB-${folio} de ${order.folio}`,
            reference: { type: "sales_order", id: order.id },
          });
          await db
            .update(salesOrderLines)
            .set({ reservedQty: "0", shippedQty: formatQty(qtyFromDb(line.shippedQty) + reserved) })
            .where(eq(salesOrderLines.id, line.id));
        }
        await db
          .update(salesOrders)
          .set({
            fulfillmentStatus: unwrap(transitionFulfillment(order.fulfillmentStatus as FulfillmentState, "shipped")),
            carrier: input.carrier,
            trackingNumber: input.trackingNumber ?? null,
            shipmentFolio: `EMB-${folio}`,
            shippedAt: new Date(),
          })
          .where(eq(salesOrders.id, order.id));
        await setStatus(db, tenant, order, "shipped", "shipped", `EMB-${folio} · ${input.carrier}`);
      });
    });
  }

  @Post("orders/:id/deliver")
  async deliver(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "deliver", async (db, tenant, order) => {
      const collected = await db
        .update(payments)
        .set({ status: "completed" })
        .where(and(eq(payments.salesOrderId, order.id), eq(payments.method, "cod"), eq(payments.status, "pending")))
        .returning();
      await db
        .update(salesOrders)
        .set({ fulfillmentStatus: "delivered", deliveredAt: new Date() })
        .where(eq(salesOrders.id, order.id));
      await refreshPaymentStatus(db, order.id, BigInt(order.totalMinor));
      await setStatus(db, tenant, order, "delivered", "delivered", collected.length ? "Cobro contra entrega recibido" : null);
    });
  }

  @Post("orders/:id/lines/:lineId/resolution")
  async resolveService(
    @CurrentUser() actor: Actor,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ) {
    const tenant = assertRole(actor, [...SALES_ROLES]);
    const input = z
      .object({
        resolution: z.enum(SERVICE_RESOLUTIONS),
        note: z.string().trim().max(300).optional(),
      })
      .parse(body);
    return this.database.asUser(tenant, async (db) => {
      const order = await loadOrder(db, id);
      if (order.status === "completed" || order.status === "cancelled") {
        throw new AppError("order_action_blocked", "El pedido ya está cerrado.", 409);
      }
      const line = (await loadOrderLines(db, order.id)).find((row) => row.id === lineId);
      if (!line) throw new AppError("not_found", "No encontramos esa partida.", 404);
      if (line.lineKind !== "service") {
        throw new AppError("not_a_service", "Solo las partidas de servicio tienen resolución.", 409);
      }
      const next = transitionServiceResolution(line.resolution as ServiceResolution, input.resolution);
      if (!next.ok) throw next.error;
      await db
        .update(salesOrderLines)
        .set({ resolution: next.value, resolutionNote: input.note ?? line.resolutionNote })
        .where(eq(salesOrderLines.id, line.id));
      await orderEvent(db, tenant, order.id, "service_resolution", {
        from: line.resolution,
        to: next.value,
        note: input.note ?? line.description,
      });
      return orderDetail(db, tenant, order.id);
    });
  }

  @Post("orders/:id/complete")
  async complete(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.step(actor, id, "complete", async (db, tenant, order) => {
      await setStatus(db, tenant, order, "completed", "completed");
    });
  }

  /** Valida la acción con las mismas reglas que ve la pantalla, la ejecuta y regresa el detalle. */
  private async step(
    actor: Actor,
    id: string,
    action: OrderAction,
    run: (db: Db, tenant: TenantActor, order: OrderRow) => Promise<unknown>,
  ) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => {
      const order = await loadOrder(db, id);
      assertOrderAction(await orderContext(db, tenant, order), action);
      await run(db, tenant, order);
      return orderDetail(db, tenant, order.id);
    });
  }
}

async function setStatus(
  db: Db,
  tenant: TenantActor,
  order: OrderRow,
  to: SalesOrderState,
  kind: string,
  note: string | null = null,
): Promise<OrderRow> {
  const fresh = await loadOrder(db, order.id);
  const from = fresh.status as SalesOrderState;
  const status = from === to ? to : unwrap(transitionSalesOrder(from, to));
  const [row] = await db
    .update(salesOrders)
    .set({ status, updatedAt: new Date() })
    .where(eq(salesOrders.id, order.id))
    .returning();
  await orderEvent(db, tenant, order.id, kind, { from, to: status, note });
  await audit(db, tenant, `sales_order.${kind}`, "sales_order", order.id, { from, to: status, note });
  return row;
}

async function setFulfillment(db: Db, tenant: TenantActor, order: OrderRow, to: FulfillmentState) {
  const next = unwrap(transitionFulfillment(order.fulfillmentStatus as FulfillmentState, to));
  await db.update(salesOrders).set({ fulfillmentStatus: next, updatedAt: new Date() }).where(eq(salesOrders.id, order.id));
  await orderEvent(db, tenant, order.id, to === "picking" ? "picked" : "packed", { from: order.fulfillmentStatus, to: next });
}

async function defaultShipTo(db: Db, customerId: string) {
  const addresses = await db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId));
  const address =
    addresses.find((row: { kind: string }) => row.kind === "shipping") ??
    addresses.find((row: { kind: string }) => row.kind === "fiscal");
  if (!address) return null;
  return { line1: address.line1, neighborhood: address.neighborhood, postalCode: address.postalCode, state: address.state };
}

export async function orderDetail(db: Db, tenant: TenantActor, id: string) {
  const order = await loadOrder(db, id);
  const lines = await loadOrderLines(db, order.id);
  const ledger: PaymentRow[] = await orderLedger(db, order.id);
  const context = await orderContext(db, tenant, order);
  const production = await db
    .select({
      id: productionOrders.id,
      folio: productionOrders.folio,
      status: productionOrders.status,
      quantityOrdered: productionOrders.quantityOrdered,
      quantityCompleted: productionOrders.quantityCompleted,
      dueDate: productionOrders.dueDate,
      sku: products.sku,
      name: products.name,
    })
    .from(productionOrders)
    .innerJoin(products, eq(products.id, productionOrders.productId))
    .where(eq(productionOrders.salesOrderId, order.id))
    .orderBy(asc(productionOrders.createdAt));
  const documents = await db
    .select({
      id: commercialDocuments.id,
      series: commercialDocuments.series,
      folio: commercialDocuments.folio,
      status: commercialDocuments.status,
      createdAt: commercialDocuments.createdAt,
    })
    .from(commercialDocuments)
    .where(eq(commercialDocuments.salesOrderId, order.id))
    .orderBy(asc(commercialDocuments.createdAt));
  const events = await db
    .select()
    .from(salesOrderEvents)
    .where(eq(salesOrderEvents.salesOrderId, order.id))
    .orderBy(asc(salesOrderEvents.createdAt));
  const skus = new Map<string, string>();
  const serviceUnits = new Map<string, string>();
  for (const line of lines) {
    if (line.productId && !skus.has(line.productId)) {
      const [product] = await db.select({ sku: products.sku }).from(products).where(eq(products.id, line.productId)).limit(1);
      if (product) skus.set(line.productId, product.sku);
    }
    if (line.serviceId && !serviceUnits.has(line.serviceId)) {
      const [service] = await db.select({ unit: serviceOfferings.unit }).from(serviceOfferings).where(eq(serviceOfferings.id, line.serviceId)).limit(1);
      if (service) serviceUnits.set(line.serviceId, service.unit);
    }
  }
  const supply = await orderSupply(db, lines);
  const due = dueMinor(BigInt(order.totalMinor), ledger);
  const canSeeMoney = canReadSalePrice(tenant.role);
  return {
    ...mapOrder(order, tenant.role),
    amountDue: canSeeMoney ? Money.fromMinor(due).toMajor() : null,
    globalDiscount: canSeeMoney ? Money.fromMinor(globalDiscountMinor(order, lines)).toMajor() : null,
    fullyAllocated: context.fullyAllocated,
    lines: lines.map((line, index) => ({
      ...mapOrderLine(line, tenant.role),
      uom: line.lineKind === "filament" ? "g" : line.lineKind === "service" ? (line.serviceId ? (serviceUnits.get(line.serviceId) ?? "servicio") : "servicio") : "pza",
      sku: line.productId ? (skus.get(line.productId) ?? null) : null,
      stocked: supply[index]?.stocked ?? false,
      open: formatQty(supply[index] ? openQuantity(supply[index]) : 0n),
    })),
    actions: orderActions(context),
    production: production.map((row: { quantityOrdered: string; quantityCompleted: string }) => ({
      ...row,
      quantityOrdered: formatQty(qtyFromDb(row.quantityOrdered)),
      quantityCompleted: formatQty(qtyFromDb(row.quantityCompleted)),
    })),
    prefacturas: documents.map((row: { series: string; folio: number; createdAt: Date }) => ({
      ...row,
      label: `${row.series}-${row.folio}`,
      createdAt: isoDate(row.createdAt),
    })),
    payments: canSeeMoney ? ledger.map((row) => mapPayment(row, tenant.role)) : [],
    events: events.map(
      (row: { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: Date }) => ({
        id: row.id,
        kind: row.kind,
        from: row.fromStatus,
        to: row.toStatus,
        note: row.note,
        createdAt: isoDate(row.createdAt),
      }),
    ),
  };
}

function paymentTermsLabel(value: string): string {
  if (value === "net_15") return "Crédito 15 días";
  if (value === "net_30") return "Crédito 30 días";
  return "Contado (PUE)";
}