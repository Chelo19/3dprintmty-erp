import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  assertOrderAction,
  orderActions,
  extendCostMinor,
  formatQty,
  maxQty,
  minQty,
  parseQty,
  qtyFromDb,
  QC_GATES,
  qcOutcome,
  requiresInspection,
  roundDiv,
  transitionProductionOrder,
  type ProductionOrderState,
  type QcGate,
  type QcRigor,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  companyProfiles,
  defectTypes,
  filaments,
  inspections,
  locations,
  productionConsumptions,
  productionOrderMaterials,
  productionOrderOperations,
  productionOrders,
  products,
  salesOrders,
  workCenters,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { assertManufacturable, createProductionOrder, laborMinor } from "./manufacturing.shared";
import {
  fulfillLinkedOrder,
  loadOrder as loadSalesOrder,
  loadOrderLines,
  manufacturableIds,
  orderContext,
  orderEvent,
  orderLocation,
  orderSupply,
  productionFor,
  syncOrderState,
  uncoveredShortage,
} from "./orders.shared";
import {
  allocateFolio,
  allocateFolios,
  audit,
  availableAt,
  defaultLocationId,
  minorToMajor,
  one,
  postStock,
  reserveStock,
  unwrap,
  type Db,
} from "./support";

const SHOP_FLOOR = ["owner", "admin", "production", "operator"] as const;
const RUNNING: ProductionOrderState[] = ["released", "scheduled", "in_progress"];

const createSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.string(),
  locationId: z.string().uuid().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.number().int().min(1).max(5).default(3),
  notes: z.string().trim().max(300).optional(),
});

const transitionSchema = z.object({
  to: z.enum(["released", "scheduled", "in_progress", "on_hold", "cancelled"]),
  reason: z.string().trim().max(200).optional(),
});

const consumeSchema = z.object({
  materialId: z.string().uuid(),
  quantity: z.string(),
});

const operationSchema = z.object({
  status: z.enum(["running", "complete", "skipped"]),
  actualMinutes: z.string().optional(),
});

const completeSchema = z.object({
  quantityGood: z.string(),
  quantityScrapped: z.string().default("0"),
  scrapReason: z.string().trim().max(200).optional(),
  shortReason: z.string().trim().max(200).optional(),
});

const inspectionSchema = z.object({
  result: z.enum(["pass", "fail"]),
  qtyPassed: z.string(),
  qtyFailed: z.string().default("0"),
  defectTypeId: z.string().uuid().optional(),
  disposition: z.enum(["rework", "scrap"]).optional(),
  notes: z.string().trim().max(500).optional(),
});

const defectSchema = z.object({
  code: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(80),
});

const qcSettingsSchema = z.object({ qcGate: z.enum(QC_GATES) });

@Controller()
export class ProductionController {
  private get database() {
    return services().database;
  }

  @Get("production-orders")
  async list(@CurrentUser() actor: Actor, @Query("status") status?: string, @Query("salesOrderId") salesOrderId?: string) {
    const tenant = requireTenant(actor);
    const filters = [
      status ? inArray(productionOrders.status, status.split(",")) : undefined,
      salesOrderId ? eq(productionOrders.salesOrderId, salesOrderId) : undefined,
    ].filter(Boolean);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          order: productionOrders,
          sku: products.sku,
          name: products.name,
          stockUom: products.stockUom,
        })
        .from(productionOrders)
        .innerJoin(products, eq(products.id, productionOrders.productId))
        .where(filters.length ? and(...(filters as never[])) : undefined)
        .orderBy(desc(productionOrders.createdAt)),
    );
    return {
      data: rows.map((row: { order: OrderRow; sku: string; name: string; stockUom: string }) =>
        mapOrder(row.order, row),
      ),
    };
  }

  /** Pedidos confirmados con producto fabricable. Una impresión no entra aquí. */
  @Get("production-orders/sales-demand")
  async salesDemand(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const data = await this.database.asUser(tenant, async (db) => {
      const orders = await db
        .select()
        .from(salesOrders)
        .where(inArray(salesOrders.status, ["confirmed", "in_production"]));
      const demand = [];
      for (const order of orders) {
        const make = orderActions(await orderContext(db, tenant, order)).find((item) => item.action === "make");
        if (!make?.allowed) continue;
        demand.push({ id: order.id, folio: order.folio, customerName: order.customerName });
      }
      return demand;
    });
    return { data };
  }

  @Get("production-orders/:id")
  async get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, (db) => loadDetail(db, id));
  }

  @Post("production-orders")
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    const input = createSchema.parse(body);
    const quantity = parseQty(input.quantity);
    if (quantity <= 0n) throw new AppError("invalid_quantity", "La cantidad debe ser mayor a cero.");
    await this.database.asUser(tenant, (db) => assertManufacturable(db, input.productId));
    const folio = await allocateFolio(this.database, tenant.tenantId, "production_order", "OP");
    return this.database.asUser(tenant, async (db) => {
      const locationId = input.locationId
        ? (await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.")).id
        : await defaultLocationId(db);
      const order = await createProductionOrder(db, tenant, {
        folio: `OP-${folio}`,
        productId: input.productId,
        quantity,
        locationId,
        dueDate: input.dueDate ?? null,
        priority: input.priority,
        notes: input.notes ?? null,
        source: "manual",
        kind: "make_to_stock",
      });
      await audit(db, tenant, "production_order.created", "production_order", order.id, { folio: order.folio });
      return loadDetail(db, order.id);
    });
  }

  /** Crea OP solo por el faltante del pedido que no cubren el apartado ni otras OP abiertas. */
  @Post("production-orders/from-sales-order/:orderId")
  async fromSalesOrder(@CurrentUser() actor: Actor, @Param("orderId") orderId: string) {
    const tenant = requireTenant(actor);
    const read = async (db: Db) => {
      const order = await loadSalesOrder(db, orderId);
      assertOrderAction(await orderContext(db, tenant, order), "make");
      const supply = await orderSupply(db, await loadOrderLines(db, order.id));
      const production = await productionFor(db, order.id);
      const shortage = uncoveredShortage(supply, production.pendingOutput);
      const makeable = await manufacturableIds(db, [...shortage.keys()]);
      const items = [...shortage.entries()]
        .filter(([productId]) => makeable.has(productId))
        .map(([productId, quantity]) => ({ productId, quantity }));
      return { order, items };
    };
    const plan = await this.database.asUser(tenant, read);
    if (!plan.items.length) {
      throw new AppError("nothing_to_make", "El pedido no tiene faltantes que se puedan fabricar.", 409);
    }
    const first = await allocateFolios(this.database, tenant.tenantId, "production_order", "OP", plan.items.length);
    return this.database.asUser(tenant, async (db) => {
      const { order: salesOrder, items } = await read(db);
      const locationId = await orderLocation(db, salesOrder);
      const created = [];
      for (const [position, item] of items.entries()) {
        const order = await createProductionOrder(db, tenant, {
          folio: `OP-${first + position}`,
          productId: item.productId,
          quantity: item.quantity,
          locationId,
          salesOrderId: salesOrder.id,
          dueDate: salesOrder.promisedDate ?? null,
          notes: `Para el pedido ${salesOrder.folio}`,
          source: "sales_order",
          kind: "make_to_order",
        });
        created.push(order);
      }
      await syncOrderState(db, tenant, salesOrder.id);
      await orderEvent(db, tenant, salesOrder.id, "production_created", {
        note: created.map((order: { folio: string }) => order.folio).join(", "),
      });
      await audit(db, tenant, "production_order.created_from_sales_order", "sales_order", salesOrder.id, {
        productionOrders: created.map((order: { folio: string }) => order.folio),
      });
      return { data: created.map((order: OrderRow) => mapOrder(order)) };
    });
  }

  @Post("production-orders/:id/release")
  async release(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      const next = unwrap(transitionProductionOrder(order.status as ProductionOrderState, "released"));
      const shortages = await reserveMaterials(db, tenant, order);
      await db
        .update(productionOrders)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(productionOrders.id, order.id));
      await audit(db, tenant, "production_order.released", "production_order", order.id, { shortages: shortages.length });
      return { ...(await loadDetail(db, order.id)), shortages };
    });
  }

  @Post("production-orders/:id/transition")
  async transition(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    const input = transitionSchema.parse(body);
    if (input.to === "released") {
      const detail = await this.database.asUser(tenant, async (db) => {
        const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
        return order.status;
      });
      if (detail === "draft") return this.release(actor, id);
    }
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      const next = unwrap(transitionProductionOrder(order.status as ProductionOrderState, input.to));
      if (next === "cancelled") {
        if (!input.reason) throw new AppError("reason_required", "Indica por qué se cancela la orden.");
        await releaseAllocations(db, tenant, order, "Cancelación de OP");
      }
      await db
        .update(productionOrders)
        .set({
          status: next,
          ...(next === "in_progress" && !order.startedAt ? { startedAt: new Date() } : {}),
          ...(input.reason ? { notes: [order.notes, input.reason].filter(Boolean).join("\n") } : {}),
          updatedAt: new Date(),
        })
        .where(eq(productionOrders.id, order.id));
      if (next === "cancelled") await fulfillLinkedOrder(db, tenant, order.salesOrderId);
      await audit(db, tenant, `production_order.${next}`, "production_order", order.id, { reason: input.reason ?? null });
      return loadDetail(db, order.id);
    });
  }

  @Post("production-orders/:id/consume")
  async consume(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    const input = consumeSchema.parse(body);
    const quantity = parseQty(input.quantity);
    if (quantity <= 0n) throw new AppError("invalid_quantity", "La cantidad debe ser mayor a cero.");
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      if (!RUNNING.includes(order.status as ProductionOrderState)) {
        throw new AppError("order_not_running", "Libera la orden antes de consumir material.", 409);
      }
      const material = await one(db, productionOrderMaterials, productionOrderMaterials.id, input.materialId, "No encontramos ese material.");
      if (material.productionOrderId !== order.id) {
        throw new AppError("not_found", "Ese material no pertenece a la orden.", 404);
      }
      await issueMaterial(db, tenant, order, material, quantity);
      if (order.status !== "in_progress") {
        await db
          .update(productionOrders)
          .set({ status: "in_progress", startedAt: order.startedAt ?? new Date(), updatedAt: new Date() })
          .where(eq(productionOrders.id, order.id));
      }
      return loadDetail(db, order.id);
    });
  }

  @Post("production-orders/:id/operations/:operationId")
  async updateOperation(
    @CurrentUser() actor: Actor,
    @Param("id") id: string,
    @Param("operationId") operationId: string,
    @Body() body: unknown,
  ) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    const input = operationSchema.parse(body);
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      const operation = await one(db, productionOrderOperations, productionOrderOperations.id, operationId, "No encontramos esa operación.");
      if (operation.productionOrderId !== order.id) throw new AppError("not_found", "Esa operación no pertenece a la orden.", 404);
      if (!RUNNING.includes(order.status as ProductionOrderState)) {
        throw new AppError("order_not_running", "La orden no está en proceso.", 409);
      }
      const minutes = input.actualMinutes !== undefined ? new Decimal(input.actualMinutes) : null;
      if (minutes && minutes.lt(0)) throw new AppError("invalid_minutes", "Los minutos no pueden ser negativos.");
      await db
        .update(productionOrderOperations)
        .set({
          status: input.status,
          ...(input.status === "running" && !operation.startedAt ? { startedAt: new Date() } : {}),
          ...(input.status !== "running" ? { completedAt: new Date() } : {}),
          ...(minutes ? { actualMinutes: minutes.toFixed(2) } : {}),
        })
        .where(eq(productionOrderOperations.id, operation.id));
      if (order.status !== "in_progress") {
        await db
          .update(productionOrders)
          .set({ status: "in_progress", startedAt: order.startedAt ?? new Date(), updatedAt: new Date() })
          .where(eq(productionOrders.id, order.id));
      }
      return loadDetail(db, order.id);
    });
  }

  @Post("production-orders/:id/complete")
  async complete(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    const input = completeSchema.parse(body);
    const good = parseQty(input.quantityGood);
    const scrapped = parseQty(input.quantityScrapped);
    if (good < 0n || scrapped < 0n || good + scrapped <= 0n) {
      throw new AppError("invalid_quantity", "Indica cuántas piezas salieron buenas o de merma.");
    }
    if (scrapped > 0n && !input.scrapReason) {
      throw new AppError("scrap_reason_required", "Indica el motivo de la merma.");
    }
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      if (!RUNNING.includes(order.status as ProductionOrderState)) {
        throw new AppError("order_not_running", "La orden no está en proceso.", 409);
      }
      const ordered = qtyFromDb(order.quantityOrdered);
      const produced = good + scrapped;
      if (produced < ordered && !input.shortReason) {
        throw new AppError("short_reason_required", "Salieron menos piezas de las ordenadas; indica el motivo.");
      }
      const materials = await db
        .select()
        .from(productionOrderMaterials)
        .where(eq(productionOrderMaterials.productionOrderId, order.id));
      for (const material of materials) {
        const expected = roundDiv(qtyFromDb(material.requiredQty) * minQty(produced, ordered), ordered);
        const missing = expected - qtyFromDb(material.consumedQty);
        if (missing > 0n) await issueMaterial(db, tenant, order, material, missing);
      }
      await releaseAllocations(db, tenant, order, "Sobrante al terminar OP");
      const operations = await db
        .select()
        .from(productionOrderOperations)
        .where(eq(productionOrderOperations.productionOrderId, order.id));
      for (const operation of operations) {
        if (operation.status === "complete" || operation.status === "skipped") continue;
        await db
          .update(productionOrderOperations)
          .set({ status: "complete", completedAt: new Date(), actualMinutes: operation.actualMinutes ?? operation.plannedMinutes })
          .where(eq(productionOrderOperations.id, operation.id));
      }
      const actualCost = await actualCostMinor(db, order.id);
      const product = await one(db, products, products.id, order.productId, "No encontramos el producto.");
      const gate = await qcGate(db);
      const needsQc = requiresInspection(product.qcRigor as QcRigor, gate);
      const next = unwrap(transitionProductionOrder("in_progress", needsQc ? "qc_hold" : "completed"));
      await db
        .update(productionOrders)
        .set({
          status: next,
          quantityCompleted: formatQty(good),
          quantityScrapped: formatQty(qtyFromDb(order.quantityScrapped) + scrapped),
          scrapReason: input.scrapReason ?? order.scrapReason,
          shortReason: input.shortReason ?? order.shortReason,
          actualCostMinor: actualCost,
          qcStatus: needsQc ? "pending" : "not_required",
          startedAt: order.startedAt ?? new Date(),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(productionOrders.id, order.id));
      if (!needsQc) await receiveFinishedGoods(db, tenant, order, good, actualCost);
      await audit(db, tenant, `production_order.${next}`, "production_order", order.id, {
        good: formatQty(good),
        scrapped: formatQty(scrapped),
        actualCostMinor: actualCost.toString(),
      });
      return loadDetail(db, order.id);
    });
  }

  @Post("production-orders/:id/inspections")
  async inspect(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    const input = inspectionSchema.parse(body);
    const passed = parseQty(input.qtyPassed);
    const failed = parseQty(input.qtyFailed);
    if (passed < 0n || failed < 0n) throw new AppError("invalid_quantity", "Las cantidades no pueden ser negativas.");
    if (input.result === "fail" && failed === 0n) {
      throw new AppError("invalid_quantity", "Una inspección fallida necesita piezas rechazadas.");
    }
    if (input.result === "pass" && failed > 0n) {
      throw new AppError("invalid_quantity", "Si hay piezas rechazadas, la inspección es fallida.");
    }
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      if (order.status !== "qc_hold") {
        throw new AppError("order_not_in_qc", "La orden no está esperando inspección.", 409);
      }
      const completed = qtyFromDb(order.quantityCompleted);
      if (passed + failed !== completed) {
        throw new AppError("qty_mismatch", `Inspecciona las ${formatQty(completed)} piezas terminadas.`);
      }
      if (input.defectTypeId) await one(db, defectTypes, defectTypes.id, input.defectTypeId, "No encontramos ese defecto.");
      const gate = await qcGate(db);
      const outcome =
        input.result === "fail" && input.disposition === "rework"
          ? "rework"
          : unwrap(qcOutcome(gate, input.result, input.disposition));
      await db.insert(inspections).values({
        tenantId: tenant.tenantId,
        productionOrderId: order.id,
        result: input.result,
        qtyPassed: formatQty(passed),
        qtyFailed: formatQty(failed),
        defectTypeId: input.defectTypeId ?? null,
        disposition: input.disposition ?? null,
        notes: input.notes ?? null,
        createdBy: tenant.userId,
      });
      if (outcome === "rework") {
        await db
          .update(productionOrders)
          .set({
            status: unwrap(transitionProductionOrder("qc_hold", "in_progress")),
            qcStatus: "failed",
            quantityCompleted: "0",
            updatedAt: new Date(),
          })
          .where(eq(productionOrders.id, order.id));
      } else {
        const scrap = input.disposition === "scrap" ? failed : 0n;
        const good = completed - scrap;
        await db
          .update(productionOrders)
          .set({
            status: unwrap(transitionProductionOrder("qc_hold", "completed")),
            qcStatus: input.result === "pass" ? "passed" : "failed",
            quantityCompleted: formatQty(good),
            quantityScrapped: formatQty(qtyFromDb(order.quantityScrapped) + scrap),
            ...(scrap > 0n ? { scrapReason: input.notes ?? order.scrapReason ?? "Rechazo de calidad" } : {}),
            updatedAt: new Date(),
          })
          .where(eq(productionOrders.id, order.id));
        await receiveFinishedGoods(db, tenant, order, good, BigInt(order.actualCostMinor ?? 0n));
      }
      await audit(db, tenant, "production_order.inspected", "production_order", order.id, {
        result: input.result,
        outcome,
        gate,
      });
      return loadDetail(db, order.id);
    });
  }

  @Post("production-orders/:id/waive-qc")
  async waive(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(body);
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      if (order.status !== "qc_hold") throw new AppError("order_not_in_qc", "La orden no está esperando inspección.", 409);
      await db
        .update(productionOrders)
        .set({ status: "completed", qcStatus: "waived", updatedAt: new Date() })
        .where(eq(productionOrders.id, order.id));
      await receiveFinishedGoods(db, tenant, order, qtyFromDb(order.quantityCompleted), BigInt(order.actualCostMinor ?? 0n));
      await audit(db, tenant, "production_order.qc_waived", "production_order", order.id, { reason });
      return loadDetail(db, order.id);
    });
  }

  @Post("production-orders/:id/close")
  async close(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, [...SHOP_FLOOR]);
    return this.database.asUser(tenant, async (db) => {
      const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
      const next = unwrap(transitionProductionOrder(order.status as ProductionOrderState, "closed"));
      await db
        .update(productionOrders)
        .set({ status: next, closedAt: new Date(), updatedAt: new Date() })
        .where(eq(productionOrders.id, order.id));
      await fulfillLinkedOrder(db, tenant, order.salesOrderId);
      await audit(db, tenant, "production_order.closed", "production_order", order.id, {});
      return loadDetail(db, order.id);
    });
  }

  @Get("quality/queue")
  async queue(@CurrentUser() actor: Actor) {
    return this.list(actor, "qc_hold");
  }

  @Get("quality/inspections")
  async listInspections(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: inspections.id,
          productionOrderId: inspections.productionOrderId,
          folio: productionOrders.folio,
          sku: products.sku,
          name: products.name,
          result: inspections.result,
          qtyPassed: inspections.qtyPassed,
          qtyFailed: inspections.qtyFailed,
          disposition: inspections.disposition,
          defect: defectTypes.name,
          notes: inspections.notes,
          createdAt: inspections.createdAt,
        })
        .from(inspections)
        .innerJoin(productionOrders, eq(productionOrders.id, inspections.productionOrderId))
        .innerJoin(products, eq(products.id, productionOrders.productId))
        .leftJoin(defectTypes, eq(defectTypes.id, inspections.defectTypeId))
        .orderBy(desc(inspections.createdAt)),
    );
    const total = rows.length;
    const failedCount = rows.filter((row: { result: string }) => row.result === "fail").length;
    return {
      data: rows.map((row: { qtyPassed: string; qtyFailed: string }) => ({
        ...row,
        qtyPassed: formatQty(qtyFromDb(row.qtyPassed)),
        qtyFailed: formatQty(qtyFromDb(row.qtyFailed)),
      })),
      stats: { total, failed: failedCount, passRate: total ? Math.round(((total - failedCount) / total) * 100) : null },
    };
  }

  @Get("quality/defect-types")
  async listDefects(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) => db.select().from(defectTypes).orderBy(defectTypes.code));
    return { data: rows.map((row: { id: string; code: string; name: string; active: boolean }) => ({ id: row.id, code: row.code, name: row.name, active: row.active })) };
  }

  @Post("quality/defect-types")
  async createDefect(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "production"]);
    const input = defectSchema.parse(body);
    const [row] = await this.database.asUser(tenant, async (db) => {
      const [existing] = await db.select().from(defectTypes).where(eq(defectTypes.code, input.code)).limit(1);
      if (existing) throw new AppError("duplicate_code", "Ya existe un defecto con esa clave.", 409);
      return db
        .insert(defectTypes)
        .values({ tenantId: tenant.tenantId, code: input.code, name: input.name, createdBy: tenant.userId })
        .returning();
    });
    return { id: row.id, code: row.code, name: row.name, active: row.active };
  }

  @Get("quality/settings")
  async settings(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const gate = await this.database.asUser(tenant, (db) => qcGate(db));
    return { qcGate: gate };
  }

  @Patch("quality/settings")
  async updateSettings(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner"]);
    const input = qcSettingsSchema.parse(body);
    await this.database.asUser(tenant, async (db) => {
      await db.update(companyProfiles).set({ qcGate: input.qcGate, updatedAt: new Date() });
      await audit(db, tenant, "quality.gate_changed", "company_profile", null, { qcGate: input.qcGate });
    });
    return { qcGate: input.qcGate };
  }
}

async function qcGate(db: Db): Promise<QcGate> {
  const [company] = await db.select({ qcGate: companyProfiles.qcGate }).from(companyProfiles).limit(1);
  return (company?.qcGate ?? "warn") as QcGate;
}

async function reserveMaterials(db: Db, tenant: TenantActor, order: OrderRow) {
  const materials = await db
    .select()
    .from(productionOrderMaterials)
    .where(eq(productionOrderMaterials.productionOrderId, order.id));
  const shortages: Array<{ productId: string; sku: string; short: string }> = [];
  for (const material of materials) {
    if (material.componentFilamentId) continue;
    const need = qtyFromDb(material.requiredQty) - qtyFromDb(material.consumedQty) - qtyFromDb(material.allocatedQty);
    if (need <= 0n) continue;
    const available = maxQty(0n, await availableAt(db, materialStock(material), order.locationId));
    const reserve = minQty(need, available);
    if (reserve > 0n) {
      await reserveStock(db, tenant, {
        ...materialStock(material),
        locationId: order.locationId,
        quantity: reserve,
        reason: `Apartado para ${order.folio}`,
        reference: { type: "production_order", id: order.id },
      });
      await db
        .update(productionOrderMaterials)
        .set({ allocatedQty: formatQty(qtyFromDb(material.allocatedQty) + reserve) })
        .where(eq(productionOrderMaterials.id, material.id));
    }
    if (reserve < need) {
      const stockId = material.componentFilamentId ?? material.componentProductId;
      const [named] = material.componentFilamentId
        ? await db.select({ sku: filaments.sku }).from(filaments).where(eq(filaments.id, material.componentFilamentId)).limit(1)
        : await db.select({ sku: products.sku }).from(products).where(eq(products.id, material.componentProductId as string)).limit(1);
      shortages.push({ productId: stockId ?? "", sku: named?.sku ?? "", short: formatQty(need - reserve) });
    }
  }
  return shortages;
}

async function releaseAllocations(db: Db, tenant: TenantActor, order: OrderRow, reason: string) {
  const materials = await db
    .select()
    .from(productionOrderMaterials)
    .where(eq(productionOrderMaterials.productionOrderId, order.id));
  for (const material of materials) {
    const allocated = qtyFromDb(material.allocatedQty);
    if (allocated <= 0n) continue;
    await reserveStock(db, tenant, {
      ...materialStock(material),
      locationId: order.locationId,
      quantity: -allocated,
      reason: `${reason} ${order.folio}`,
      reference: { type: "production_order", id: order.id },
    });
    await db.update(productionOrderMaterials).set({ allocatedQty: "0" }).where(eq(productionOrderMaterials.id, material.id));
  }
}

async function issueMaterial(
  db: Db,
  tenant: TenantActor,
  order: OrderRow,
  material: MaterialRow,
  quantity: bigint,
) {
  const allocated = qtyFromDb(material.allocatedQty);
  const release = minQty(allocated, quantity);
  const value = extendCostMinor(quantity, new Decimal(String(material.unitCostMinor)));
  if (material.componentFilamentId) {
    // El filamento se ajusta al pesar el rollo, igual que en las impresiones de un pedido: solo cuenta en el costo.
    if (release > 0n) {
      await reserveStock(db, tenant, {
        filamentId: material.componentFilamentId,
        locationId: order.locationId,
        quantity: -release,
        reason: `El filamento de ${order.folio} se ajusta al pesar el rollo`,
        reference: { type: "production_order", id: order.id },
      });
    }
  } else {
    await postStock(db, tenant, {
      ...materialStock(material),
      locationId: order.locationId,
      kind: "issue",
      delta: -quantity,
      reason: `Consumo en ${order.folio}`,
      releaseAllocated: release,
      valueMinor: value,
      reference: { type: "production_order", id: order.id },
    });
  }
  await db.insert(productionConsumptions).values({
    tenantId: tenant.tenantId,
    productionOrderId: order.id,
    materialId: material.id,
    ...(material.componentFilamentId
      ? { filamentId: material.componentFilamentId, productId: null }
      : { productId: material.componentProductId, filamentId: null }),
    quantity: formatQty(quantity),
    valueMinor: value,
    source: "backflush",
    createdBy: tenant.userId,
  });
  const [fresh] = await db
    .select()
    .from(productionOrderMaterials)
    .where(eq(productionOrderMaterials.id, material.id))
    .limit(1);
  await db
    .update(productionOrderMaterials)
    .set({
      consumedQty: formatQty(qtyFromDb(fresh.consumedQty) + quantity),
      allocatedQty: formatQty(maxQty(0n, qtyFromDb(fresh.allocatedQty) - release)),
    })
    .where(eq(productionOrderMaterials.id, material.id));
}

async function actualCostMinor(db: Db, orderId: string): Promise<bigint> {
  const consumptions = await db
    .select({ valueMinor: productionConsumptions.valueMinor })
    .from(productionConsumptions)
    .where(eq(productionConsumptions.productionOrderId, orderId));
  const operations = await db
    .select()
    .from(productionOrderOperations)
    .where(eq(productionOrderOperations.productionOrderId, orderId));
  const material = consumptions.reduce((sum: bigint, row: { valueMinor: bigint }) => sum + BigInt(row.valueMinor), 0n);
  const labor = operations.reduce((sum: bigint, row: OperationRow) => {
    if (row.status === "skipped") return sum;
    return sum + laborMinor(String(row.actualMinutes ?? row.plannedMinutes), BigInt(row.hourlyRateMinor));
  }, 0n);
  return material + labor;
}

/** Da entrada al terminado y, si la OP es de un pedido, se lo aparta y le acomoda el estado. */
async function receiveFinishedGoods(db: Db, tenant: TenantActor, order: OrderRow, good: bigint, costMinor: bigint) {
  if (good > 0n) {
    await postStock(db, tenant, {
      productId: order.productId,
      locationId: order.locationId,
      kind: "receipt",
      delta: good,
      reason: `Terminado de ${order.folio}`,
      valueMinor: costMinor,
      reference: { type: "production_order", id: order.id },
    });
  }
  await fulfillLinkedOrder(db, tenant, order.salesOrderId);
}

async function loadDetail(db: Db, id: string) {
  const order = await one(db, productionOrders, productionOrders.id, id, "No encontramos esa orden de producción.");
  const [product] = await db.select().from(products).where(eq(products.id, order.productId)).limit(1);
  const materials = await db
    .select()
    .from(productionOrderMaterials)
    .where(eq(productionOrderMaterials.productionOrderId, order.id));
  const operations = await db
    .select({ operation: productionOrderOperations, workCenterName: workCenters.name })
    .from(productionOrderOperations)
    .innerJoin(workCenters, eq(workCenters.id, productionOrderOperations.workCenterId))
    .where(eq(productionOrderOperations.productionOrderId, order.id));
  const consumptions = await db
    .select()
    .from(productionConsumptions)
    .where(eq(productionConsumptions.productionOrderId, order.id))
    .orderBy(desc(productionConsumptions.createdAt));
  const checks = await db
    .select({ inspection: inspections, defect: defectTypes.name })
    .from(inspections)
    .leftJoin(defectTypes, eq(defectTypes.id, inspections.defectTypeId))
    .where(eq(inspections.productionOrderId, order.id))
    .orderBy(desc(inspections.createdAt));
  const [sales] = order.salesOrderId
    ? await db.select({ folio: salesOrders.folio }).from(salesOrders).where(eq(salesOrders.id, order.salesOrderId)).limit(1)
    : [];

  const materialRows = [];
  for (const material of materials as MaterialRow[]) {
    const required = qtyFromDb(material.requiredQty);
    const consumed = qtyFromDb(material.consumedQty);
    const allocated = qtyFromDb(material.allocatedQty);
    const tracksStock = !material.componentFilamentId;
    const available = await availableAt(db, materialStock(material), order.locationId);
    const open = maxQty(0n, required - consumed);
    const named = material.componentFilamentId
      ? await db.select({ sku: filaments.sku, name: filaments.name }).from(filaments).where(eq(filaments.id, material.componentFilamentId)).limit(1)
      : await db.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.id, material.componentProductId as string)).limit(1);
    const info = named[0];
    materialRows.push({
      id: material.id,
      componentProductId: material.componentFilamentId ?? material.componentProductId,
      sku: info?.sku ?? "",
      name: info?.name ?? "",
      stockUom: material.componentFilamentId ? "G" : "EA",
      required: formatQty(required),
      allocated: formatQty(allocated),
      consumed: formatQty(consumed),
      available: formatQty(available),
      shortage: tracksStock ? formatQty(maxQty(0n, open - allocated - maxQty(0n, available))) : "0",
      tracksStock,
      unitCostMinor: String(material.unitCostMinor),
    });
  }

  return {
    ...mapOrder(order, product),
    salesOrderFolio: sales?.folio ?? null,
    qcRigor: product?.qcRigor ?? "off",
    materials: materialRows,
    operations: (operations as Array<{ operation: OperationRow; workCenterName: string }>)
      .map(({ operation, workCenterName }) => ({
        id: operation.id,
        sequence: operation.sequence,
        code: operation.code,
        name: operation.name,
        workCenterName,
        plannedMinutes: String(operation.plannedMinutes),
        actualMinutes: operation.actualMinutes === null ? null : String(operation.actualMinutes),
        status: operation.status,
      }))
      .sort((a, b) => a.sequence - b.sequence),
    consumptions: (consumptions as ConsumptionRow[]).map((consumption) => ({
        id: consumption.id,
        sku: "",
        quantity: formatQty(qtyFromDb(consumption.quantity)),
        value: minorToMajor(consumption.valueMinor),
        source: consumption.source,
        createdAt: consumption.createdAt,
      })),
    inspections: (checks as Array<{ inspection: InspectionRow; defect: string | null }>).map(({ inspection, defect }) => ({
      id: inspection.id,
      result: inspection.result,
      qtyPassed: formatQty(qtyFromDb(inspection.qtyPassed)),
      qtyFailed: formatQty(qtyFromDb(inspection.qtyFailed)),
      disposition: inspection.disposition,
      defect,
      notes: inspection.notes,
      createdAt: inspection.createdAt,
    })),
  };
}

function mapOrder(row: OrderRow, product?: { sku?: string; name?: string; stockUom?: string } | null) {
  return {
    id: row.id,
    folio: row.folio,
    productId: row.productId,
    sku: product?.sku ?? null,
    name: product?.name ?? null,
    stockUom: product?.stockUom ?? null,
    locationId: row.locationId,
    salesOrderId: row.salesOrderId,
    source: row.source,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    quantityOrdered: formatQty(qtyFromDb(row.quantityOrdered)),
    quantityCompleted: formatQty(qtyFromDb(row.quantityCompleted)),
    quantityScrapped: formatQty(qtyFromDb(row.quantityScrapped)),
    dueDate: row.dueDate,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    closedAt: row.closedAt,
    estimatedCost: row.estimatedCostMinor === null ? null : minorToMajor(row.estimatedCostMinor),
    actualCost: row.actualCostMinor === null ? null : minorToMajor(row.actualCostMinor),
    qcStatus: row.qcStatus,
    scrapReason: row.scrapReason,
    shortReason: row.shortReason,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

interface OrderRow {
  id: string;
  folio: string;
  productId: string;
  locationId: string;
  salesOrderId: string | null;
  source: string;
  kind: string;
  status: string;
  priority: number;
  quantityOrdered: string;
  quantityCompleted: string;
  quantityScrapped: string;
  dueDate: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  estimatedCostMinor: bigint | null;
  actualCostMinor: bigint | null;
  qcStatus: string;
  scrapReason: string | null;
  shortReason: string | null;
  notes: string | null;
  createdAt: Date;
}

function materialStock(material: { componentProductId: string | null; componentFilamentId: string | null }) {
  return material.componentFilamentId
    ? { filamentId: material.componentFilamentId }
    : { productId: material.componentProductId as string };
}

interface MaterialRow {
  id: string;
  productionOrderId: string;
  componentProductId: string | null;
  componentFilamentId: string | null;
  requiredQty: string;
  allocatedQty: string;
  consumedQty: string;
  unitCostMinor: string;
}

interface OperationRow {
  id: string;
  sequence: number;
  code: string;
  name: string;
  plannedMinutes: string;
  actualMinutes: string | null;
  hourlyRateMinor: bigint;
  status: string;
}

interface ConsumptionRow {
  id: string;
  quantity: string;
  valueMinor: bigint;
  source: string;
  createdAt: Date;
}

interface InspectionRow {
  id: string;
  result: string;
  qtyPassed: string;
  qtyFailed: string;
  disposition: string | null;
  notes: string | null;
  createdAt: Date;
}
