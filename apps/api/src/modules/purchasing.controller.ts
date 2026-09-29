import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import {
  assertRfc,
  extendCostMinor,
  formatQty,
  Money,
  mulQty,
  parseQty,
  qtyFromDb,
  roundDiv,
  stockUnitCostMinor,
  transitionPurchaseOrder,
  type PurchaseOrderState,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  companyProfiles,
  locations,
  products,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receipts,
  spoolEvents,
  spools,
  stockBalances,
  vendors,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { roundMinor } from "./manufacturing.shared";
import { ensureLot } from "./spools.controller";
import {
  allocateFolio,
  allocateFolios,
  audit,
  defaultLocationId,
  minorToMajor,
  one,
  postStock,
  unwrap,
  withIdempotency,
  type Db,
} from "./support";

const BUYERS = ["owner", "admin", "warehouse"] as const;
/** Tolerancia de báscula al comparar la suma de rollos contra lo recibido: 0.1 g. */
const SPOOL_TOLERANCE = 1_000n;

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  rfc: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(30).optional(),
  paymentTerms: z.enum(["contado", "net_15", "net_30", "net_60"]).default("contado"),
  leadTimeDays: z.number().int().min(0).max(365).default(0),
  notes: z.string().trim().max(300).optional(),
});

const vendorPatchSchema = vendorSchema.partial().extend({ active: z.boolean().optional() });

const lineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.string(),
  unitCost: z.string().optional(),
  description: z.string().trim().max(200).optional(),
});

const purchaseSchema = z.object({
  vendorId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(300).optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

const transitionSchema = z.object({
  to: z.enum(["ordered", "cancelled", "closed"]),
  reason: z.string().trim().max(200).optional(),
});

const receiveSchema = z.object({
  notes: z.string().trim().max(300).optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantity: z.string(),
        lotNumber: z.string().trim().max(60).optional(),
        vendorLot: z.string().trim().max(60).optional(),
        spoolWeights: z.array(z.string()).max(200).optional(),
      }),
    )
    .min(1),
});

export interface NewPurchaseLine {
  productId: string;
  quantity: bigint;
  unitCostMinor?: bigint | null;
  description?: string;
}

@Controller()
export class PurchasingController {
  private get database() {
    return services().database;
  }

  @Get("vendors")
  async listVendors(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) => db.select().from(vendors).orderBy(vendors.name));
    return { data: rows.map(mapVendor) };
  }

  @Post("vendors")
  async createVendor(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = vendorSchema.parse(body);
    const [row] = await this.database.asUser(tenant, (db) =>
      db
        .insert(vendors)
        .values({
          tenantId: tenant.tenantId,
          name: input.name,
          rfc: input.rfc ? assertRfc(input.rfc) : null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          paymentTerms: input.paymentTerms,
          leadTimeDays: input.leadTimeDays,
          notes: input.notes ?? null,
          createdBy: tenant.userId,
        })
        .returning(),
    );
    return mapVendor(row);
  }

  @Patch("vendors/:id")
  async updateVendor(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = vendorPatchSchema.parse(body);
    const row = await this.database.asUser(tenant, async (db) => {
      const vendor = await one(db, vendors, vendors.id, id, "No encontramos ese proveedor.");
      const [updated] = await db
        .update(vendors)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.rfc !== undefined ? { rfc: input.rfc ? assertRfc(input.rfc) : null } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
          ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(vendors.id, vendor.id))
        .returning();
      return updated;
    });
    return mapVendor(row);
  }

  @Get("purchase-orders")
  async list(@CurrentUser() actor: Actor, @Query("status") status?: string) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select()
        .from(purchaseOrders)
        .where(status ? inArray(purchaseOrders.status, status.split(",")) : undefined)
        .orderBy(desc(purchaseOrders.createdAt)),
    );
    return { data: rows.map(mapPurchaseOrder) };
  }

  @Get("purchase-orders/:id")
  async get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, (db) => loadPurchaseOrder(db, id));
  }

  @Post("purchase-orders")
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = purchaseSchema.parse(body);
    const lines: NewPurchaseLine[] = input.lines.map((line) => ({
      productId: line.productId,
      quantity: parseQty(line.quantity),
      unitCostMinor: line.unitCost ? Money.fromMajor(line.unitCost).minor : null,
      description: line.description,
    }));
    const folio = await allocateFolio(this.database, tenant.tenantId, "purchase_order", "OC");
    return this.database.asUser(tenant, async (db) => {
      const order = await createPurchaseOrder(db, tenant, {
        folio: `OC-${folio}`,
        vendorId: input.vendorId,
        locationId: input.locationId,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        lines,
      });
      return loadPurchaseOrder(db, order.id);
    });
  }

  @Post("purchase-orders/:id/transition")
  async transition(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = transitionSchema.parse(body);
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, purchaseOrders, purchaseOrders.id, id, "No encontramos esa orden de compra.");
      const next = unwrap(transitionPurchaseOrder(order.status as PurchaseOrderState, input.to));
      if (next === "cancelled" && !input.reason) {
        throw new AppError("reason_required", "Indica por qué se cancela la orden de compra.");
      }
      await db
        .update(purchaseOrders)
        .set({
          status: next,
          ...(next === "ordered" ? { orderedAt: new Date() } : {}),
          ...(next === "closed" ? { closedAt: new Date() } : {}),
          ...(input.reason ? { notes: [order.notes, input.reason].filter(Boolean).join("\n") } : {}),
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, order.id));
      await audit(db, tenant, `purchase_order.${next}`, "purchase_order", order.id, { reason: input.reason ?? null });
      return loadPurchaseOrder(db, order.id);
    });
  }

  @Post("purchase-orders/:id/receive")
  async receive(
    @CurrentUser() actor: Actor,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = receiveSchema.parse(body);
    return withIdempotency(this.database, tenant.userId, idempotencyKey, { route: "receive", id, input }, () =>
      this.doReceive(tenant, id, input),
    );
  }

  private async doReceive(tenant: TenantActor, id: string, input: z.infer<typeof receiveSchema>) {
    const spoolCount = input.lines.reduce((sum, line) => sum + (line.spoolWeights?.length ?? 0), 0);
    await this.database.asUser(tenant, (db) => prepareReceipt(db, id, input));
    const receiptFolio = await allocateFolio(this.database, tenant.tenantId, "receipt", "REC");
    const firstSpool = await allocateFolios(this.database, tenant.tenantId, "spool", "R", spoolCount);
    let nextSpool = firstSpool;
    return this.database.asUser(tenant, async (db) => {
      const { order, lines: prepared } = await prepareReceipt(db, id, input);
      const [receipt] = await db
        .insert(receipts)
        .values({
          tenantId: tenant.tenantId,
          folio: `REC-${receiptFolio}`,
          purchaseOrderId: order.id,
          locationId: order.locationId,
          notes: input.notes ?? null,
          createdBy: tenant.userId,
        })
        .returning();
      const created: Array<{ spoolNumber: string; grams: string }> = [];
      for (const [position, { entry, line, product, quantity, stockQty, value, weights }] of prepared.entries()) {
        await updateAverageCost(db, product, stockQty, value);
        const lotId = await ensureLot(
          db,
          tenant,
          product.id,
          entry.lotNumber || `${receipt.folio}-${position + 1}`,
          stockQty,
          {
            source: "purchase",
            vendorLot: entry.vendorLot ?? null,
            vendorId: order.vendorId,
            purchaseOrderId: order.id,
            receiptId: receipt.id,
          },
        );
        await postStock(db, tenant, {
          productId: product.id,
          locationId: order.locationId,
          kind: "receipt",
          delta: stockQty,
          reason: `Recepción ${receipt.folio} de ${order.folio}`,
          valueMinor: value,
          reference: { type: "receipt", id: receipt.id },
          lotId,
        });
        await db.insert(receiptLines).values({
          tenantId: tenant.tenantId,
          receiptId: receipt.id,
          purchaseOrderLineId: line.id,
          productId: product.id,
          quantity: formatQty(quantity),
          stockQuantity: formatQty(stockQty),
          lotId,
          valueMinor: value,
        });
        await db
          .update(purchaseOrderLines)
          .set({ receivedQty: formatQty(qtyFromDb(line.receivedQty) + quantity) })
          .where(eq(purchaseOrderLines.id, line.id));
        for (const grams of weights) {
          const spoolNumber = `R-${nextSpool}`;
          nextSpool += 1;
          const [spool] = await db
            .insert(spools)
            .values({
              tenantId: tenant.tenantId,
              spoolNumber,
              productId: product.id,
              locationId: order.locationId,
              lotId,
              initialGrams: formatQty(grams),
              currentGrams: formatQty(grams),
              status: "available",
              createdBy: tenant.userId,
            })
            .returning();
          await db.insert(spoolEvents).values({
            tenantId: tenant.tenantId,
            spoolId: spool.id,
            kind: "receipt",
            grams: formatQty(grams),
            reason: `Recepción ${receipt.folio}`,
            createdBy: tenant.userId,
          });
          created.push({ spoolNumber, grams: formatQty(grams) });
        }
      }
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, order.id));
      const complete = lines.every((line: LineRow) => qtyFromDb(line.receivedQty) >= qtyFromDb(line.quantity));
      const next = unwrap(
        transitionPurchaseOrder(order.status as PurchaseOrderState, complete ? "received" : "partially_received"),
      );
      await db
        .update(purchaseOrders)
        .set({ status: next, ...(complete ? { receivedAt: new Date() } : {}), updatedAt: new Date() })
        .where(eq(purchaseOrders.id, order.id));
      await audit(db, tenant, "purchase_order.received", "receipt", receipt.id, {
        purchaseOrder: order.folio,
        spools: created.length,
      });
      return {
        receipt: { id: receipt.id, folio: receipt.folio },
        spools: created,
        purchaseOrder: await loadPurchaseOrder(db, order.id),
      };
    });
  }
}

/** Valida la recepción completa sin escribir; se corre antes de asignar folios para no dejar huecos. */
async function prepareReceipt(db: Db, id: string, input: z.infer<typeof receiveSchema>) {
  const order = await one(db, purchaseOrders, purchaseOrders.id, id, "No encontramos esa orden de compra.");
  if (order.status !== "ordered" && order.status !== "partially_received") {
    throw new AppError("order_not_receivable", "Solo se reciben órdenes colocadas con el proveedor.", 409);
  }
  const ids = input.lines.map((entry) => entry.lineId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("duplicate_line", "Una línea aparece dos veces en la recepción.");
  }
  const lines = [];
  for (const entry of input.lines) {
    const line: LineRow = await one(db, purchaseOrderLines, purchaseOrderLines.id, entry.lineId, "No encontramos esa línea.");
    if (line.purchaseOrderId !== order.id) throw new AppError("not_found", "Esa línea es de otra orden de compra.", 404);
    const quantity = parseQty(entry.quantity);
    if (quantity <= 0n) throw new AppError("invalid_quantity", "La cantidad recibida debe ser mayor a cero.");
    const pending = qtyFromDb(line.quantity) - qtyFromDb(line.receivedQty);
    if (quantity > pending) {
      throw new AppError("over_receipt", `Solo quedan ${formatQty(pending)} ${line.purchaseUom} por recibir de ${line.description}.`, 409);
    }
    const product = await one(db, products, products.id, line.productId, "No encontramos ese producto.");
    const stockQty = mulQty(quantity, parseQty(String(line.uomFactor)));
    const value = extendCostMinor(quantity, new Decimal(String(line.unitCostMinor)));
    const weights = (entry.spoolWeights ?? []).map((weight) => {
      const grams = parseQty(weight);
      if (grams <= 0n) throw new AppError("invalid_quantity", "Cada rollo necesita un peso mayor a cero.");
      return grams;
    });
    if (weights.length) {
      if (product.stockUom !== "G") {
        throw new AppError("not_filament", "Solo los filamentos se reciben por rollo.", 409);
      }
      const total = weights.reduce((sum, grams) => sum + grams, 0n);
      const diff = total > stockQty ? total - stockQty : stockQty - total;
      if (diff > SPOOL_TOLERANCE) {
        throw new AppError(
          "spool_weights_mismatch",
          `Los rollos suman ${formatQty(total)} g pero se reciben ${formatQty(stockQty)} g.`,
        );
      }
    }
    lines.push({ entry, line, product, quantity, stockQty, value, weights });
  }
  return { order, lines };
}

/** Costo promedio ponderado por unidad de compra (lo que el catálogo guarda: MXN/kg, MXN/pieza). */
async function updateAverageCost(
  db: Db,
  product: { id: string; costMinor: bigint | string | null; uomFactor: string },
  receivedStockQty: bigint,
  receivedValueMinor: bigint,
) {
  const balances = await db.select({ onHand: stockBalances.onHand }).from(stockBalances).where(eq(stockBalances.productId, product.id));
  const onHand = balances.reduce((sum: bigint, row: { onHand: string }) => sum + qtyFromDb(row.onHand), 0n);
  const factor = new Decimal(String(product.uomFactor));
  const currentCost = product.costMinor === null ? null : BigInt(product.costMinor);
  let perStock: Decimal;
  if (onHand <= 0n || currentCost === null) {
    perStock = new Decimal(receivedValueMinor.toString()).div(new Decimal(formatQty(receivedStockQty)));
  } else {
    const existingValue = new Decimal(formatQty(onHand)).mul(stockUnitCostMinor(currentCost, String(product.uomFactor)));
    perStock = existingValue
      .add(receivedValueMinor.toString())
      .div(new Decimal(formatQty(onHand + receivedStockQty)));
  }
  await db
    .update(products)
    .set({ costMinor: roundMinor(perStock.mul(factor)), updatedAt: new Date() })
    .where(eq(products.id, product.id));
}

export async function createPurchaseOrder(
  db: Db,
  tenant: TenantActor,
  input: {
    folio: string;
    vendorId: string;
    locationId?: string;
    expectedDate?: string | null;
    notes?: string | null;
    plannedOrderId?: string | null;
    lines: NewPurchaseLine[];
  },
) {
  const vendor = await one(db, vendors, vendors.id, input.vendorId, "No encontramos ese proveedor.");
  if (!vendor.active) throw new AppError("vendor_inactive", "Ese proveedor está inactivo.", 409);
  const locationId = input.locationId
    ? (await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.")).id
    : await defaultLocationId(db);
  const prepared = [];
  for (const line of input.lines) {
    if (line.quantity <= 0n) throw new AppError("invalid_quantity", "Cada línea necesita cantidad mayor a cero.");
    const product = await one(db, products, products.id, line.productId, "No encontramos ese producto.");
    if (product.productType === "service") throw new AppError("invalid_product", "Los servicios no se compran a inventario.", 409);
    const unit = line.unitCostMinor ?? (product.costMinor === null ? 0n : BigInt(product.costMinor));
    if (unit < 0n) throw new AppError("invalid_money", "El costo no puede ser negativo.");
    prepared.push({
      product,
      quantity: line.quantity,
      unit,
      total: extendCostMinor(line.quantity, new Decimal(unit.toString())),
      description: line.description || `${product.sku} ${product.name}`,
    });
  }
  const subtotal = prepared.reduce((sum, line) => sum + line.total, 0n);
  const [company] = await db.select({ rate: companyProfiles.defaultVatRate }).from(companyProfiles).limit(1);
  const vat = roundDiv(subtotal * parseQty(String(company?.rate ?? "0.16")), 10_000n);
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      tenantId: tenant.tenantId,
      folio: input.folio,
      vendorId: vendor.id,
      vendorName: vendor.name,
      locationId,
      status: "draft",
      expectedDate: input.expectedDate ?? null,
      subtotalMinor: subtotal,
      vatMinor: vat,
      totalMinor: subtotal + vat,
      plannedOrderId: input.plannedOrderId ?? null,
      notes: input.notes ?? null,
      createdBy: tenant.userId,
    })
    .returning();
  await db.insert(purchaseOrderLines).values(
    prepared.map((line) => ({
      tenantId: tenant.tenantId,
      purchaseOrderId: order.id,
      productId: line.product.id,
      description: line.description,
      purchaseUom: line.product.purchaseUom,
      uomFactor: String(line.product.uomFactor),
      quantity: formatQty(line.quantity),
      unitCostMinor: line.unit,
      lineTotalMinor: line.total,
    })),
  );
  await audit(db, tenant, "purchase_order.created", "purchase_order", order.id, { folio: order.folio });
  return order;
}

async function loadPurchaseOrder(db: Db, id: string) {
  const order = await one(db, purchaseOrders, purchaseOrders.id, id, "No encontramos esa orden de compra.");
  const lines = await db
    .select({ line: purchaseOrderLines, sku: products.sku, stockUom: products.stockUom })
    .from(purchaseOrderLines)
    .innerJoin(products, eq(products.id, purchaseOrderLines.productId))
    .where(eq(purchaseOrderLines.purchaseOrderId, order.id));
  const history = await db.select().from(receipts).where(eq(receipts.purchaseOrderId, order.id)).orderBy(desc(receipts.createdAt));
  return {
    ...mapPurchaseOrder(order),
    lines: (lines as Array<{ line: LineRow; sku: string; stockUom: string }>).map(({ line, sku, stockUom }) => ({
      id: line.id,
      productId: line.productId,
      sku,
      description: line.description,
      purchaseUom: line.purchaseUom,
      stockUom,
      uomFactor: formatQty(qtyFromDb(line.uomFactor)),
      quantity: formatQty(qtyFromDb(line.quantity)),
      receivedQty: formatQty(qtyFromDb(line.receivedQty)),
      pendingQty: formatQty(qtyFromDb(line.quantity) - qtyFromDb(line.receivedQty)),
      unitCost: minorToMajor(line.unitCostMinor),
      lineTotal: minorToMajor(line.lineTotalMinor),
    })),
    receipts: history.map((receipt: { id: string; folio: string; createdAt: Date; notes: string | null }) => ({
      id: receipt.id,
      folio: receipt.folio,
      notes: receipt.notes,
      createdAt: receipt.createdAt,
    })),
  };
}

function mapPurchaseOrder(row: {
  id: string;
  folio: string;
  vendorId: string;
  vendorName: string;
  locationId: string;
  status: string;
  expectedDate: string | null;
  orderedAt: Date | null;
  receivedAt: Date | null;
  subtotalMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  plannedOrderId: string | null;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    folio: row.folio,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    locationId: row.locationId,
    status: row.status,
    expectedDate: row.expectedDate,
    orderedAt: row.orderedAt,
    receivedAt: row.receivedAt,
    subtotal: minorToMajor(row.subtotalMinor),
    vat: minorToMajor(row.vatMinor),
    total: minorToMajor(row.totalMinor),
    currency: "MXN",
    plannedOrderId: row.plannedOrderId,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function mapVendor(row: {
  id: string;
  name: string;
  rfc: string | null;
  email: string | null;
  phone: string | null;
  paymentTerms: string;
  leadTimeDays: number;
  notes: string | null;
  active: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    rfc: row.rfc,
    email: row.email,
    phone: row.phone,
    paymentTerms: row.paymentTerms,
    leadTimeDays: row.leadTimeDays,
    notes: row.notes,
    active: row.active,
  };
}

interface LineRow {
  id: string;
  purchaseOrderId: string;
  productId: string;
  description: string;
  purchaseUom: string;
  uomFactor: string;
  quantity: string;
  receivedQty: string;
  unitCostMinor: bigint;
  lineTotalMinor: bigint;
}
