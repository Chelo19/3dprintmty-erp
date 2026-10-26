import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { GENERIC_RFC, Money, formatQty, parseQty, qtyFromDb, uomShort } from "@3dprintmty/domain";
import { calculateMxTax } from "@3dprintmty/fiscal";
import { AppError } from "@3dprintmty/shared";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { customerAddresses, customers, locations, paymentMethodSettings, payments, products, salesOrderLines, salesOrders, serviceOfferings, stockBalances } from "../db/schema";
import { assertRole, CurrentUser, type Actor, type TenantActor } from "../http/actor";
import { loadCompanyProfile } from "./company-profile";
import { orderEvent } from "./orders.shared";
import { allocateFolio, audit, defaultLocationId, one, postStock, withIdempotency, type Db } from "./support";
import { taxRateSchema } from "./tax-rates";

const ROLES = ["owner", "admin", "sales", "operator"] as const;
const checkoutSchema = z.object({
  customerId: z.string().uuid().optional(),
  locationId: z.string().uuid(),
  method: z.enum(["efectivo", "tarjeta", "spei"]),
  cashTendered: z.string().optional(),
  reference: z.string().trim().max(120).optional(),
  expectedTotal: z.string(),
  lines: z.array(z.object({
    kind: z.enum(["product", "service"]),
    id: z.string().uuid(),
    quantity: z.string(),
    unitPrice: z.string().optional(),
    discount: z.string().default("0"),
    vatRate: taxRateSchema.optional(),
    isrRate: taxRateSchema.optional(),
  })).min(1).max(100),
}).refine((input) => new Set(input.lines.map((line) => `${line.kind}:${line.id}`)).size === input.lines.length, "Combina las cantidades de un mismo artículo en una sola partida.");

@Controller("pos")
export class PosController {
  private get database() { return services().database; }

  @Get("catalog")
  async catalog(@CurrentUser() actor: Actor, @Query() query: unknown) {
    const tenant = assertRole(actor, ROLES);
    const input = z.object({ locationId: z.string().uuid().optional(), q: z.string().trim().max(120).default(""), type: z.enum(["all", "service", "finished", "product"]).default("all"), includeOutOfStock: z.enum(["true", "false"]).default("false") }).parse(query);
    return this.database.asUser(tenant, async (db) => {
      const locationId = input.locationId ?? await defaultLocationId(db);
      await one(db, locations, locations.id, locationId, "No encontramos esa sucursal.");
      const term = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
      const goods: Array<{ id: string; sku: string; name: string; unitPrice: bigint | null; uom: string; onHand: string | null; allocated: string | null; itemClass: string; supplyMode: string }> = input.type === "service" ? [] : await db.select({ id: products.id, sku: products.sku, name: products.name, unitPrice: products.salePriceMinor, uom: products.stockUom, itemClass: products.itemClass, supplyMode: products.supplyMode, onHand: stockBalances.onHand, allocated: stockBalances.allocated })
        .from(products).leftJoin(stockBalances, and(eq(stockBalances.productId, products.id), eq(stockBalances.locationId, locationId)))
        .where(and(eq(products.status, "active"), isNotNull(products.salePriceMinor),
          inArray(products.itemClass, input.type === "all" ? ["finished_good", "component"] : ["finished_good"]),
          input.type === "finished" ? inArray(products.supplyMode, ["make", "both"]) : input.type === "product" ? inArray(products.supplyMode, ["buy", "both"]) : undefined,
          input.includeOutOfStock === "false" ? gt(sql`coalesce(${stockBalances.onHand}, 0) - coalesce(${stockBalances.allocated}, 0)`, 0) : undefined,
          input.q ? or(ilike(products.name, term), ilike(products.sku, term)) : undefined))
        .orderBy(asc(products.name), asc(products.id)).limit(60);
      const offerings = input.type !== "all" && input.type !== "service" ? [] : await db.select().from(serviceOfferings).where(and(eq(serviceOfferings.status, "active"), isNotNull(serviceOfferings.salePriceMinor), input.q ? or(ilike(serviceOfferings.name, term), ilike(serviceOfferings.code, term)) : undefined))
        .orderBy(asc(serviceOfferings.name), asc(serviceOfferings.id)).limit(40);
      const company = await loadCompanyProfile(db);
      const methods = await db.select().from(paymentMethodSettings).where(and(eq(paymentMethodSettings.enabled, true), inArray(paymentMethodSettings.method, ["efectivo", "tarjeta", "spei"])));
      return {
        locationId,
        locations: await db.select({ id: locations.id, name: locations.name }).from(locations).orderBy(asc(locations.name)),
        vatRate: company?.defaultVatRate ?? "0", isrRate: company?.defaultIsrRate ?? "0",
        methods: methods.map((row: { method: string }) => row.method),
        items: [
          ...goods.filter((row) => row.unitPrice !== null).map((row) => ({ id: row.id, kind: "product", category: row.itemClass === "component" ? "supply" : row.supplyMode === "both" ? "mixed" : row.supplyMode === "make" ? "finished" : "product", sku: row.sku, name: row.name, uom: uomShort(row.uom), unitPrice: major(row.unitPrice!), available: formatQty(qtyFromDb(row.onHand) - qtyFromDb(row.allocated)) })),
          ...offerings.filter((row: typeof serviceOfferings.$inferSelect) => row.salePriceMinor !== null).map((row: typeof serviceOfferings.$inferSelect) => ({ id: row.id, kind: "service", category: "service", sku: row.code, name: row.name, uom: row.unit, unitPrice: major(row.salePriceMinor!), available: null })),
        ],
      };
    });
  }

  @Get("sales")
  async list(@CurrentUser() actor: Actor, @Query() query: unknown) {
    const tenant = assertRole(actor, ROLES);
    const input = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(10) }).parse(query);
    return this.database.asUser(tenant, async (db) => {
      const filter = eq(salesOrders.salesChannel, "pos");
      const rows = await db.select().from(salesOrders).where(filter).orderBy(desc(salesOrders.createdAt), desc(salesOrders.id)).limit(input.limit).offset((input.page - 1) * input.limit);
      const [total] = await db.select({ value: count() }).from(salesOrders).where(filter);
      return { data: rows.map((row: typeof salesOrders.$inferSelect) => ({ id: row.id, folio: row.folio, customerName: row.customerName, createdAt: row.createdAt, total: major(row.totalMinor) })), total: Number(total?.value ?? 0), page: input.page, limit: input.limit };
    });
  }

  @Get("sales/:id")
  async receipt(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ROLES);
    return this.database.asUser(tenant, (db) => receipt(db, id));
  }

  @Post("sales")
  async checkout(@CurrentUser() actor: Actor, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    const tenant = assertRole(actor, ROLES);
    const input = checkoutSchema.parse(body);
    return withIdempotency(this.database, tenant, key, { route: "pos.sales", input }, async () => {
      const folio = await allocateFolio(this.database, tenant.tenantId, "order", "PED");
      const sale = await this.database.asUser(tenant, async (db) => {
        const location = await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.");
        const [method] = await db.select().from(paymentMethodSettings).where(and(eq(paymentMethodSettings.method, input.method), eq(paymentMethodSettings.enabled, true)));
        if (!method) throw new AppError("payment_method_disabled", "Ese método de cobro no está activo en el taller.", 409);
        const goodsIds = input.lines.filter((line) => line.kind === "product").map((line) => line.id);
        const serviceIds = input.lines.filter((line) => line.kind === "service").map((line) => line.id);
        const goods: Array<typeof products.$inferSelect> = goodsIds.length ? await db.select().from(products).where(inArray(products.id, goodsIds)) : [];
        const offerings: Array<typeof serviceOfferings.$inferSelect> = serviceIds.length ? await db.select().from(serviceOfferings).where(inArray(serviceOfferings.id, serviceIds)) : [];
        const company = await loadCompanyProfile(db);
        const lines = input.lines.map((line) => {
          const item = line.kind === "product" ? goods.find((row) => row.id === line.id) : offerings.find((row) => row.id === line.id);
          if (!item || item.status !== "active" || item.salePriceMinor === null || ("itemClass" in item && !["finished_good", "component"].includes(item.itemClass))) throw new AppError("item_unavailable", "Un artículo ya no está disponible para venta.", 409);
          const quantity = parseQty(line.quantity);
          const price = line.unitPrice === undefined ? item.salePriceMinor : Money.fromMajor(line.unitPrice).minor;
          if (quantity <= 0n || price < 0n) throw new AppError("invalid_line", "Captura cantidades mayores a cero y precios no negativos.");
          return { ...line, description: item.name, quantity: formatQty(quantity), unitPrice: major(price), vatRate: line.vatRate ?? company?.defaultVatRate ?? "0", isrRate: line.isrRate ?? company?.defaultIsrRate ?? "0" };
        });
        const balances: Array<typeof stockBalances.$inferSelect> = goodsIds.length ? await db.select().from(stockBalances).where(and(inArray(stockBalances.productId, goodsIds), eq(stockBalances.locationId, location.id))) : [];
        for (const line of lines) if (line.kind === "product") {
          const balance = balances.find((row) => row.productId === line.id);
          if (parseQty(line.quantity) > qtyFromDb(balance?.onHand) - qtyFromDb(balance?.allocated)) throw new AppError("insufficient_stock", `No hay existencia disponible suficiente de ${line.description} en esta sucursal.`, 409);
        }
        const priced = calculateMxTax({ lines, rate: company?.defaultVatRate ?? "0", isrRate: company?.defaultIsrRate ?? "0" });
        const total = Money.fromMajor(priced.total).minor;
        if (total <= 0n) throw new AppError("invalid_total", "El total de la venta debe ser mayor a cero.");
        if (Money.fromMajor(input.expectedTotal).minor !== total) throw new AppError("total_changed", "El total cambió. Revisa los precios e impuestos antes de cobrar.", 409);
        const cashTendered = input.method === "efectivo" ? Money.fromMajor(input.cashTendered ?? "0").minor : null;
        if (cashTendered !== null && cashTendered < total) throw new AppError("insufficient_payment", "El efectivo recibido no cubre el total.");
        const customer = input.customerId
          ? await one(db, customers, customers.id, input.customerId, "No encontramos ese cliente.")
          : await generalCustomer(db, tenant, location.state);
        if (customer.status !== "active") throw new AppError("customer_inactive", "Ese cliente no puede comprar.", 409);
        const now = new Date();
        const [order] = await db.insert(salesOrders).values({
          tenantId: tenant.tenantId, folio: `PED-${folio}`, salesChannel: "pos", cashTenderedMinor: cashTendered,
          customerId: customer.id, customerName: customer.legalName, customerRfc: customer.rfc,
          status: "completed", paymentStatus: "paid", fulfillmentStatus: "delivered", paymentTerms: "pue",
          locationId: location.id, carrier: "Mostrador", shippedAt: now, deliveredAt: now,
          subtotalMinor: Money.fromMajor(priced.subtotal).minor, discountMinor: Money.fromMajor(priced.discount).minor,
          vatRate: priced.rate, isrRate: priced.isrRate, isrWithheldMinor: Money.fromMajor(priced.isrWithheld).minor,
          vatMinor: Money.fromMajor(priced.tax).minor, totalMinor: total, createdBy: tenant.userId,
        }).returning();
        await db.insert(salesOrderLines).values(lines.map((line, index) => {
          const tax = priced.lines[index]!;
          return { tenantId: tenant.tenantId, salesOrderId: order.id, position: index, lineKind: line.kind,
            productId: line.kind === "product" ? line.id : null, serviceId: line.kind === "service" ? line.id : null,
            description: line.description, quantity: line.quantity, unitPriceMinor: Money.fromMajor(line.unitPrice).minor,
            discountMinor: Money.fromMajor(line.discount).minor, netMinor: Money.fromMajor(tax.net).minor,
            vatRate: tax.rate, vatExempt: tax.vatExempt, isrRate: tax.isrRate, isrWithheldMinor: Money.fromMajor(tax.isrWithheld).minor,
            vatMinor: Money.fromMajor(tax.tax).minor, totalMinor: Money.fromMajor(tax.total).minor,
            shippedQty: line.kind === "product" ? line.quantity : "0", resolution: "delivered" };
        }));
        const [payment] = await db.insert(payments).values({ tenantId: tenant.tenantId, salesOrderId: order.id, method: input.method, kind: "payment", status: "completed", amountMinor: total, reference: input.reference || null, note: "Venta en punto de venta", createdBy: tenant.userId }).returning();
        await orderEvent(db, tenant, order.id, "pos_sale", { to: "completed", note: "Cobro y entrega en mostrador" });
        await audit(db, tenant, "payment.recorded", "payment", payment.id, { orderId: order.id, method: input.method, amountMinor: total.toString() });
        await audit(db, tenant, "pos.sale", "sales_order", order.id, { paymentId: payment.id, locationId: location.id });
        return { id: order.id, lines, locationId: location.id };
      });
      // Catálogo y sucursal se validaron con RLS; solo se descuentan artículos de esta venta nueva.
      // Ventas puede cobrar en mostrador sin obtener permisos generales para editar inventario.
      await this.database.asAdminActor(tenant, async (db) => {
        for (const line of sale.lines) if (line.kind === "product") await postStock(db, tenant, {
          productId: line.id, locationId: sale.locationId, kind: "issue", delta: -parseQty(line.quantity), allowNegative: false,
          reason: `Venta de mostrador PED-${folio}`, reference: { type: "sales_order", id: sale.id },
        });
      });
      return this.database.asUser(tenant, (db) => receipt(db, sale.id));
    });
  }
}

async function generalCustomer(db: Db, tenant: TenantActor, state: string) {
  const [existing] = await db.select().from(customers).where(and(eq(customers.rfc, GENERIC_RFC.domestic), eq(customers.legalName, "Público en general"), eq(customers.status, "active"))).orderBy(asc(customers.id)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(customers).values({ tenantId: tenant.tenantId, kind: "b2c", legalName: "Público en general", rfc: GENERIC_RFC.domestic, createdBy: tenant.userId }).returning();
  await db.insert(customerAddresses).values({ tenantId: tenant.tenantId, customerId: created.id, kind: "fiscal", line1: "", neighborhood: "", postalCode: "", state, createdBy: tenant.userId });
  return created;
}

async function receipt(db: Db, id: string) {
  const order = await one(db, salesOrders, salesOrders.id, id, "No encontramos esa venta.");
  if (order.salesChannel !== "pos") throw new AppError("not_found", "No encontramos esa venta de mostrador.", 404);
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id)).orderBy(asc(salesOrderLines.position));
  const [payment] = await db.select().from(payments).where(and(eq(payments.salesOrderId, id), eq(payments.kind, "payment"), eq(payments.status, "completed"))).orderBy(asc(payments.createdAt)).limit(1);
  const company = await loadCompanyProfile(db);
  const location = await one(db, locations, locations.id, order.locationId, "No encontramos la sucursal.");
  return {
    id, folio: order.folio, createdAt: order.createdAt, customerName: order.customerName, customerRfc: order.customerRfc,
    issuer: company?.tradeName || company?.legalName || "3dprintnow", issuerRfc: company?.rfc ?? "", locationName: location.name,
    total: major(order.totalMinor), subtotal: major(order.subtotalMinor), discount: major(order.discountMinor), vat: major(order.vatMinor), isrWithheld: major(order.isrWithheldMinor),
    method: payment?.method ?? "", reference: payment?.reference ?? null,
    cashTendered: order.cashTenderedMinor === null ? null : major(order.cashTenderedMinor),
    change: major(order.cashTenderedMinor === null ? 0n : BigInt(order.cashTenderedMinor) - BigInt(order.totalMinor)),
    lines: lines.map((line: typeof salesOrderLines.$inferSelect) => ({ id: line.id, description: line.description, quantity: formatQty(qtyFromDb(line.quantity)), unitPrice: major(line.unitPriceMinor), discount: major(line.discountMinor), net: major(line.netMinor) })),
  };
}
const major = (value: bigint) => Money.fromMinor(BigInt(value)).toMajor();
