import {
  directRequirements,
  extendCostMinor,
  formatQty,
  parseQty,
  qtyFromDb,
  rollupUnitCostMinor,
  stockUnitCostMinor,
  type BomLine,
  type BomLookup,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  bomLines,
  boms,
  productionOrderMaterials,
  productionOrderOperations,
  filaments,
  productionOrders,
  products,
  routingOperations,
  routings,
  workCenters,
} from "../db/schema";
import type { TenantActor } from "../http/actor";
import { minorToMajor, one, type Db } from "./support";

export interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  productType: string;
  stockUom: string;
  purchaseUom: string;
  uomFactor: string;
  costMinor: bigint | null;
  qcRigor: string;
}

export interface BomIndex {
  lookup: BomLookup;
  bomIdByProduct: Map<string, string>;
}

export async function loadProducts(db: Db): Promise<Map<string, ProductInfo>> {
  const rows = await db.select().from(products);
  const rolls = await db.select().from(filaments);
  const catalog = new Map<string, ProductInfo>(
    rows.map((row: ProductInfo & { costMinor: bigint | string | null }) => [
      row.id,
      { ...row, uomFactor: String(row.uomFactor), costMinor: row.costMinor === null ? null : BigInt(row.costMinor) },
    ]),
  );
  for (const row of rolls) {
    catalog.set(row.id, {
      id: row.id,
      sku: row.sku,
      name: row.name,
      productType: "filament",
      stockUom: "G",
      purchaseUom: "KG",
      uomFactor: "1000",
      costMinor: row.costMinor === null ? null : BigInt(row.costMinor),
      qcRigor: "off",
    });
  }
  return catalog;
}

export async function loadBomIndex(db: Db): Promise<BomIndex> {
  const active = await db.select().from(boms).where(eq(boms.active, true));
  const bomIdByProduct = new Map<string, string>(active.map((bom: { id: string; productId: string }) => [bom.productId, bom.id]));
  const byBom = new Map<string, BomLine[]>();
  if (active.length) {
    const lines = await db
      .select()
      .from(bomLines)
      .where(inArray(bomLines.bomId, active.map((bom: { id: string }) => bom.id)));
    for (const line of lines) {
      const list = byBom.get(line.bomId) ?? [];
      list.push({
        componentId: line.componentFilamentId ?? line.componentProductId,
        quantity: qtyFromDb(line.quantity),
        scrapPct: parseQty(String(line.scrapPct)),
      });
      byBom.set(line.bomId, list);
    }
  }
  return {
    bomIdByProduct,
    lookup: (productId) => {
      const bomId = bomIdByProduct.get(productId);
      return bomId ? byBom.get(bomId) : undefined;
    },
  };
}

export function roundMinor(minor: Decimal): bigint {
  return BigInt(minor.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

export function centsToMajor(minor: Decimal): string {
  return minorToMajor(roundMinor(minor));
}

export function leafCost(catalog: Map<string, ProductInfo>) {
  return (productId: string) => {
    const product = catalog.get(productId);
    return product ? stockUnitCostMinor(product.costMinor, product.uomFactor) : new Decimal(0);
  };
}

/** Costo unitario en centavos por unidad de almacén: rollup si tiene BOM, catálogo si es hoja. */
export function unitCostMinor(productId: string, index: BomIndex, catalog: Map<string, ProductInfo>): Decimal {
  return rollupUnitCostMinor(productId, index.lookup, leafCost(catalog));
}

export interface RoutingStep {
  sequence: number;
  code: string;
  name: string;
  workCenterId: string;
  workCenterName: string;
  setupMinutes: string;
  runMinutes: string;
  hourlyRateMinor: bigint;
}

export async function activeRouting(db: Db, productId: string): Promise<{ id: string; version: number; steps: RoutingStep[] } | null> {
  const [routing] = await db
    .select()
    .from(routings)
    .where(and(eq(routings.productId, productId), eq(routings.active, true)))
    .limit(1);
  if (!routing) return null;
  const rows = await db
    .select({
      sequence: routingOperations.sequence,
      code: routingOperations.code,
      name: routingOperations.name,
      workCenterId: routingOperations.workCenterId,
      workCenterName: workCenters.name,
      setupMinutes: routingOperations.setupMinutes,
      runMinutes: routingOperations.runMinutes,
      hourlyRateMinor: workCenters.hourlyRateMinor,
    })
    .from(routingOperations)
    .innerJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
    .where(eq(routingOperations.routingId, routing.id));
  const steps = rows
    .map((row: RoutingStep) => ({
      ...row,
      setupMinutes: String(row.setupMinutes),
      runMinutes: String(row.runMinutes),
      hourlyRateMinor: BigInt(row.hourlyRateMinor),
    }))
    .sort((a: RoutingStep, b: RoutingStep) => a.sequence - b.sequence);
  return { id: routing.id, version: routing.version, steps };
}

export function minutesFor(step: Pick<RoutingStep, "setupMinutes" | "runMinutes">, quantity: bigint): Decimal {
  const units = new Decimal(formatQty(quantity));
  return new Decimal(step.setupMinutes).add(new Decimal(step.runMinutes).mul(units));
}

export function laborMinor(minutes: Decimal.Value, hourlyRateMinor: bigint): bigint {
  const value = new Decimal(minutes).mul(hourlyRateMinor.toString()).div(60);
  return BigInt(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

/** Mano de obra por una pieza: solo tiempo de corrida, la preparación se reparte en la OP. */
export function laborPerUnitMinor(steps: readonly RoutingStep[]): Decimal {
  return steps.reduce(
    (sum, step) => sum.add(new Decimal(step.runMinutes).mul(step.hourlyRateMinor.toString()).div(60)),
    new Decimal(0),
  );
}

export interface NewProductionOrder {
  folio: string;
  productId: string;
  quantity: bigint;
  locationId: string;
  dueDate?: string | null;
  priority?: number;
  notes?: string | null;
  salesOrderId?: string | null;
  source: "manual" | "sales_order";
  kind: "make_to_order" | "make_to_stock";
}

/** Valida que se pueda fabricar; llamar también antes de asignar folio para no dejar huecos. */
export async function assertManufacturable(db: Db, productId: string) {
  const product = await one(db, products, products.id, productId, "No encontramos ese producto.");
  if (product.productType !== "finished_good") {
    throw new AppError("not_manufacturable", "Solo se fabrican productos terminados. Los insumos se compran.", 409);
  }
  if (product.status === "inactive") {
    throw new AppError("product_inactive", `«${product.name}» está inactivo. Actívalo en el catálogo para fabricarlo.`, 409);
  }
  const index = await loadBomIndex(db);
  if (!index.lookup(product.id)?.length) {
    throw new AppError("bom_required", "Ese producto no tiene lista de materiales activa.", 409);
  }
  return { product, index };
}

/** Crea la OP en borrador con foto del BOM y de la ruta vigentes. */
export async function createProductionOrder(db: Db, tenant: TenantActor, input: NewProductionOrder) {
  if (input.quantity <= 0n) throw new AppError("invalid_quantity", "La cantidad debe ser mayor a cero.");
  const { product, index } = await assertManufacturable(db, input.productId);
  const catalog = await loadProducts(db);
  const requirements = directRequirements(product.id, input.quantity, index.lookup);
  const routing = await activeRouting(db, product.id);

  const materials = [...requirements.entries()].map(([componentId, required]) => {
    const unit = unitCostMinor(componentId, index, catalog);
    return { componentId, required, unit, extended: extendCostMinor(required, unit) };
  });
  const operations = (routing?.steps ?? []).map((step) => {
    const minutes = minutesFor(step, input.quantity);
    return { step, minutes, cost: laborMinor(minutes, step.hourlyRateMinor) };
  });
  const estimated =
    materials.reduce((sum, item) => sum + item.extended, 0n) + operations.reduce((sum, item) => sum + item.cost, 0n);

  const [order] = await db
    .insert(productionOrders)
    .values({
      tenantId: tenant.tenantId,
      folio: input.folio,
      productId: product.id,
      locationId: input.locationId,
      salesOrderId: input.salesOrderId ?? null,
      source: input.source,
      kind: input.kind,
      status: "draft",
      priority: input.priority ?? 3,
      quantityOrdered: formatQty(input.quantity),
      dueDate: input.dueDate ?? null,
      bomId: index.bomIdByProduct.get(product.id) ?? null,
      routingId: routing?.id ?? null,
      estimatedCostMinor: estimated,
      qcStatus: "not_required",
      notes: input.notes ?? null,
      createdBy: tenant.userId,
    })
    .returning();
  if (materials.length) {
    await db.insert(productionOrderMaterials).values(
      materials.map((item) => ({
        tenantId: tenant.tenantId,
        productionOrderId: order.id,
        componentProductId: catalog.get(item.componentId)?.productType === "filament" ? null : item.componentId,
        componentFilamentId: catalog.get(item.componentId)?.productType === "filament" ? item.componentId : null,
        requiredQty: formatQty(item.required),
        unitCostMinor: item.unit.toFixed(6),
      })),
    );
  }
  if (operations.length) {
    await db.insert(productionOrderOperations).values(
      operations.map(({ step, minutes }) => ({
        tenantId: tenant.tenantId,
        productionOrderId: order.id,
        sequence: step.sequence,
        code: step.code,
        name: step.name,
        workCenterId: step.workCenterId,
        plannedMinutes: minutes.toFixed(2),
        hourlyRateMinor: step.hourlyRateMinor,
      })),
    );
  }
  return order;
}
