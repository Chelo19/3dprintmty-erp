import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  countsAsIncoming,
  directRequirements,
  formatQty,
  isOpenProductionOrder,
  maxQty,
  mulQty,
  parseQty,
  planRequirements,
  QTY_SCALE,
  qtyFromDb,
  transitionPlannedOrder,
  type MrpDemand,
  type MrpRow,
  type MrpSupply,
  type PlannedOrderState,
  type ProductionOrderState,
  type PurchaseOrderState,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  mrpPlannedOrders,
  mrpRuns,
  productionOrderMaterials,
  productionOrders,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockBalances,
  vendors,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor } from "../http/actor";
import {
  assertManufacturable,
  createProductionOrder,
  loadBomIndex,
  loadProducts,
  type ProductInfo,
} from "./manufacturing.shared";
import { effectiveQty } from "./orders.shared";
import { createPurchaseOrder } from "./purchasing.controller";
import { allocateFolio, audit, defaultLocationId, one, unwrap, type Db } from "./support";

const PLANNERS = ["owner", "admin", "production", "warehouse"] as const;
const DEMAND_STATES = ["confirmed", "in_production", "ready_to_ship", "on_hold"];

const runSchema = z.object({ horizonDays: z.number().int().min(1).max(365).default(30) });
const releaseSchema = z.object({ vendorId: z.string().uuid().optional() });

@Controller("mrp")
export class MrpController {
  private get database() {
    return services().database;
  }

  @Get("requirements")
  async requirements(@CurrentUser() actor: Actor, @Query("kind") kind?: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => {
      const { rows, catalog } = await computeRequirements(db);
      const filtered = kind === "buy" || kind === "make" ? rows.filter((row) => row.kind === kind) : rows;
      return { data: filtered.map((row) => mapRow(row, catalog)) };
    });
  }

  @Post("run")
  async run(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...PLANNERS]);
    const input = runSchema.parse(body ?? {});
    return this.database.asUser(tenant, async (db) => {
      const { rows, catalog } = await computeRequirements(db);
      const shortages = rows.filter((row) => row.netShortage > 0n);
      const [run] = await db
        .insert(mrpRuns)
        .values({
          tenantId: tenant.tenantId,
          horizonDays: input.horizonDays,
          stats: {
            rows: rows.length,
            buy: shortages.filter((row) => row.kind === "buy").length,
            make: shortages.filter((row) => row.kind === "make").length,
          },
          createdBy: tenant.userId,
        })
        .returning();
      await db.delete(mrpPlannedOrders).where(eq(mrpPlannedOrders.status, "planned"));
      if (shortages.length) {
        await db.insert(mrpPlannedOrders).values(
          shortages.map((row) => ({
            tenantId: tenant.tenantId,
            runId: run.id,
            productId: row.productId,
            kind: row.kind,
            quantity: formatQty(row.netShortage),
            needBy: dateOnly(row.needBy),
            releaseBy: dateOnly(row.releaseBy),
            status: "planned",
            sources: row.sources,
            createdBy: tenant.userId,
          })),
        );
      }
      await audit(db, tenant, "mrp.run", "mrp_run", run.id, run.stats);
      return {
        run: { id: run.id, horizonDays: run.horizonDays, stats: run.stats, createdAt: run.createdAt },
        rows: rows.map((row) => mapRow(row, catalog)),
        planned: await listPlanned(db, "planned,firmed"),
      };
    });
  }

  @Get("runs/latest")
  async latest(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const [run] = await this.database.asUser(tenant, (db) =>
      db.select().from(mrpRuns).orderBy(desc(mrpRuns.createdAt)).limit(1),
    );
    return run ? { id: run.id, horizonDays: run.horizonDays, stats: run.stats, createdAt: run.createdAt } : null;
  }

  @Get("planned-orders")
  async planned(@CurrentUser() actor: Actor, @Query("status") status?: string) {
    const tenant = requireTenant(actor);
    return { data: await this.database.asUser(tenant, (db) => listPlanned(db, status)) };
  }

  @Post("planned-orders/:id/firm")
  async firm(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.move(actor, id, "firmed");
  }

  @Post("planned-orders/:id/cancel")
  async cancel(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.move(actor, id, "cancelled");
  }

  @Post("planned-orders/:id/release")
  async release(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...PLANNERS]);
    const input = releaseSchema.parse(body ?? {});
    const planned = await this.database.asUser(tenant, (db) =>
      one(db, mrpPlannedOrders, mrpPlannedOrders.id, id, "No encontramos esa orden planeada."),
    );
    unwrap(transitionPlannedOrder(planned.status as PlannedOrderState, "released"));
    if (planned.kind === "buy") {
      if (!["owner", "admin", "warehouse"].includes(tenant.role)) {
        throw new AppError("forbidden", "Solo almacén o administración pueden generar órdenes de compra.", 403);
      }
      if (!input.vendorId) throw new AppError("vendor_required", "Elige el proveedor para la orden de compra.");
    } else if (!["owner", "admin", "production"].includes(tenant.role)) {
      throw new AppError("forbidden", "Solo producción o administración pueden generar órdenes de producción.", 403);
    } else {
      await this.database.asUser(tenant, (db) => assertManufacturable(db, planned.productId));
    }
    if (planned.kind === "buy") {
      await this.database.asUser(tenant, (db) => one(db, vendors, vendors.id, input.vendorId!, "No encontramos ese proveedor."));
    }
    const folio =
      planned.kind === "buy"
        ? `OC-${await allocateFolio(this.database, tenant.tenantId, "purchase_order", "OC")}`
        : `OP-${await allocateFolio(this.database, tenant.tenantId, "production_order", "OP")}`;
    return this.database.asUser(tenant, async (db) => {
      const fresh = await one(db, mrpPlannedOrders, mrpPlannedOrders.id, id, "No encontramos esa orden planeada.");
      const next = unwrap(transitionPlannedOrder(fresh.status as PlannedOrderState, "released"));
      const quantity = qtyFromDb(fresh.quantity);
      let releasedId: string;
      if (fresh.kind === "buy") {
        const catalog = await loadProducts(db);
        const product = catalog.get(fresh.productId);
        if (!product) throw new AppError("not_found", "No encontramos ese producto.", 404);
        const order = await createPurchaseOrder(db, tenant, {
          folio,
          vendorId: input.vendorId!,
          expectedDate: fresh.needBy,
          notes: "Generada desde MRP",
          plannedOrderId: fresh.id,
          lines: [{ productId: product.id, quantity: toPurchaseUnits(quantity, product) }],
        });
        releasedId = order.id;
      } else {
        const order = await createProductionOrder(db, tenant, {
          folio,
          productId: fresh.productId,
          quantity,
          locationId: await defaultLocationId(db),
          dueDate: fresh.needBy,
          plannedOrderId: fresh.id,
          notes: "Generada desde MRP",
          source: "mrp_planned",
          kind: "make_to_stock",
        });
        releasedId = order.id;
      }
      await db
        .update(mrpPlannedOrders)
        .set({
          status: next,
          releasedType: fresh.kind === "buy" ? "purchase_order" : "production_order",
          releasedId,
          updatedAt: new Date(),
        })
        .where(eq(mrpPlannedOrders.id, fresh.id));
      await audit(db, tenant, "mrp.planned_released", "mrp_planned_order", fresh.id, { folio });
      return {
        releasedType: fresh.kind === "buy" ? "purchase_order" : "production_order",
        releasedId,
        folio,
      };
    });
  }

  private async move(actor: Actor, id: string, to: PlannedOrderState) {
    const tenant = assertRole(actor, [...PLANNERS]);
    return this.database.asUser(tenant, async (db) => {
      const planned = await one(db, mrpPlannedOrders, mrpPlannedOrders.id, id, "No encontramos esa orden planeada.");
      const next = unwrap(transitionPlannedOrder(planned.status as PlannedOrderState, to));
      await db.update(mrpPlannedOrders).set({ status: next, updatedAt: new Date() }).where(eq(mrpPlannedOrders.id, planned.id));
      await audit(db, tenant, `mrp.planned_${next}`, "mrp_planned_order", planned.id, {});
      const [row] = await listPlanned(db, undefined, planned.id);
      return row;
    });
  }
}

/** Compra en unidad del proveedor, redondeando hacia arriba para no quedarse corto. */
function toPurchaseUnits(stockQty: bigint, product: ProductInfo): bigint {
  const factor = parseQty(product.uomFactor);
  if (factor === QTY_SCALE) return stockQty;
  const scaled = stockQty * QTY_SCALE;
  return (scaled + factor - 1n) / factor;
}

async function computeRequirements(db: Db) {
  const catalog = await loadProducts(db);
  const index = await loadBomIndex(db);
  const supply = new Map<string, MrpSupply>();
  const supplyFor = (productId: string) => {
    let entry = supply.get(productId);
    if (!entry) {
      entry = { productId, onHand: 0n, incoming: 0n, scheduledOutput: 0n, reorderPoint: 0n, leadTimeDays: 0 };
      supply.set(productId, entry);
    }
    return entry;
  };
  const demands: MrpDemand[] = [];

  for (const balance of await db.select().from(stockBalances)) {
    if (catalog.get(balance.productId)?.productType === "service") continue;
    const entry = supplyFor(balance.productId);
    entry.onHand += qtyFromDb(balance.onHand);
    entry.reorderPoint += qtyFromDb(balance.reorderPoint);
    entry.leadTimeDays = Math.max(entry.leadTimeDays, Number(balance.leadTimeDays ?? 0));
  }

  const openPurchases = await db.select().from(purchaseOrders);
  const incomingIds = openPurchases
    .filter((order: { status: string }) => countsAsIncoming(order.status as PurchaseOrderState))
    .map((order: { id: string }) => order.id);
  if (incomingIds.length) {
    const lines = await db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, incomingIds));
    for (const line of lines) {
      const pending = maxQty(0n, qtyFromDb(line.quantity) - qtyFromDb(line.receivedQty));
      supplyFor(line.productId).incoming += mulQty(pending, parseQty(String(line.uomFactor)));
    }
  }

  const orders = await db.select().from(productionOrders);
  const openOrders = orders.filter((order: { status: string }) => isOpenProductionOrder(order.status as ProductionOrderState));
  for (const order of openOrders) {
    const remaining = qtyFromDb(order.quantityOrdered) - qtyFromDb(order.quantityCompleted) - qtyFromDb(order.quantityScrapped);
    if (remaining > 0n) supplyFor(order.productId).scheduledOutput += remaining;
  }
  if (openOrders.length) {
    const materials = await db
      .select()
      .from(productionOrderMaterials)
      .where(inArray(productionOrderMaterials.productionOrderId, openOrders.map((order: { id: string }) => order.id)));
    const byOrder = new Map(openOrders.map((order: { id: string; folio: string; dueDate: string | null }) => [order.id, order]));
    for (const material of materials) {
      const open = maxQty(0n, qtyFromDb(material.requiredQty) - qtyFromDb(material.consumedQty));
      if (open === 0n) continue;
      const order = byOrder.get(material.productionOrderId) as { id: string; folio: string; dueDate: string | null };
      demands.push({
        productId: material.componentProductId,
        quantity: open,
        needBy: order.dueDate ? new Date(`${order.dueDate}T00:00:00Z`) : null,
        source: { type: "production_order", id: order.id, folio: order.folio },
      });
    }
  }

  const firmed = await db.select().from(mrpPlannedOrders).where(eq(mrpPlannedOrders.status, "firmed"));
  for (const planned of firmed) {
    const quantity = qtyFromDb(planned.quantity);
    if (planned.kind === "buy") {
      supplyFor(planned.productId).incoming += quantity;
      continue;
    }
    supplyFor(planned.productId).scheduledOutput += quantity;
    for (const [componentId, required] of directRequirements(planned.productId, quantity, index.lookup)) {
      demands.push({
        productId: componentId,
        quantity: required,
        needBy: planned.needBy ? new Date(`${planned.needBy}T00:00:00Z`) : null,
        source: { type: "planned_make", id: planned.id, folio: "Planeada firme" },
      });
    }
  }

  const sales = await db.select().from(salesOrders).where(inArray(salesOrders.status, DEMAND_STATES));
  if (sales.length) {
    const byId = new Map(sales.map((order: SalesDemandRow) => [order.id, order]));
    const lines = await db
      .select()
      .from(salesOrderLines)
      .where(inArray(salesOrderLines.salesOrderId, sales.map((order: { id: string }) => order.id)));
    for (const line of lines) {
      if (!line.productId) continue;
      const product = catalog.get(line.productId);
      if (!product || product.productType === "service") continue;
      const quantity = effectiveQty(line) - qtyFromDb(line.shippedQty);
      if (quantity <= 0n) continue;
      const order = byId.get(line.salesOrderId) as SalesDemandRow;
      demands.push({
        productId: line.productId,
        quantity,
        needBy: order.promisedDate ? new Date(`${order.promisedDate}T00:00:00Z`) : null,
        source: { type: "sales_order", id: order.id, folio: order.folio },
      });
    }
  }

  const rows = planRequirements({ demands, supply, bom: index.lookup });
  return { rows, catalog };
}

async function listPlanned(db: Db, status?: string, id?: string) {
  const vendorRows = await db.select({ id: vendors.id }).from(vendors).limit(1);
  const catalog = await loadProducts(db);
  const rows = await db
    .select()
    .from(mrpPlannedOrders)
    .where(
      id
        ? eq(mrpPlannedOrders.id, id)
        : status
          ? inArray(mrpPlannedOrders.status, status.split(","))
          : undefined,
    )
    .orderBy(mrpPlannedOrders.releaseBy);
  return rows.map((row: PlannedRow) => {
    const product = catalog.get(row.productId);
    return {
      id: row.id,
      productId: row.productId,
      sku: product?.sku ?? "",
      name: product?.name ?? "",
      stockUom: product?.stockUom ?? "EA",
      kind: row.kind,
      quantity: formatQty(qtyFromDb(row.quantity)),
      purchaseQuantity:
        row.kind === "buy" && product ? formatQty(toPurchaseUnits(qtyFromDb(row.quantity), product)) : null,
      purchaseUom: product?.purchaseUom ?? null,
      needBy: row.needBy,
      releaseBy: row.releaseBy,
      status: row.status,
      sources: row.sources,
      releasedType: row.releasedType,
      releasedId: row.releasedId,
      hasVendors: vendorRows.length > 0,
    };
  });
}

function mapRow(row: MrpRow, catalog: Map<string, ProductInfo>) {
  const product = catalog.get(row.productId);
  return {
    productId: row.productId,
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    stockUom: product?.stockUom ?? "EA",
    level: row.level,
    kind: row.kind,
    grossDemand: formatQty(row.grossDemand),
    onHand: formatQty(row.onHand),
    incoming: formatQty(row.incoming),
    scheduledOutput: formatQty(row.scheduledOutput),
    reorderPoint: formatQty(row.reorderPoint),
    netShortage: formatQty(row.netShortage),
    purchaseQuantity: row.kind === "buy" && product ? formatQty(toPurchaseUnits(row.netShortage, product)) : null,
    purchaseUom: product?.purchaseUom ?? null,
    needBy: dateOnly(row.needBy),
    releaseBy: dateOnly(row.releaseBy),
    sources: row.sources,
  };
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

interface SalesDemandRow {
  id: string;
  folio: string;
  promisedDate: string | null;
}

interface PlannedRow {
  id: string;
  productId: string;
  kind: string;
  quantity: string;
  needBy: string | null;
  releaseBy: string | null;
  status: string;
  sources: unknown;
  releasedType: string | null;
  releasedId: string | null;
}