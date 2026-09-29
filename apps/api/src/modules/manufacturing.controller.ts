import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createsBomCycle,
  extendCostMinor,
  formatQty,
  lineRequirement,
  Money,
  parseQty,
  QTY_SCALE,
  type BomLine,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { bomLines, boms, products, routingOperations, routings, workCenters } from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import {
  activeRouting,
  centsToMajor,
  laborPerUnitMinor,
  loadBomIndex,
  loadProducts,
  unitCostMinor,
  type BomIndex,
  type ProductInfo,
} from "./manufacturing.shared";
import { audit, minorToMajor, one, type Db } from "./support";

const ENGINEERING = ["owner", "admin", "production"] as const;

const workCenterSchema = z.object({
  code: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["printer", "post_process", "quality", "packing", "other"]),
  hourlyRate: z.string().default("0"),
  capacityHours: z.string().default("8"),
});

const workCenterPatchSchema = workCenterSchema.partial().extend({ active: z.boolean().optional() });

const bomSchema = z.object({
  productId: z.string().uuid(),
  notes: z.string().trim().max(300).optional(),
  lines: z
    .array(
      z.object({
        componentProductId: z.string().uuid(),
        quantity: z.string(),
        scrapPct: z.string().default("0"),
      }),
    )
    .min(1)
    .max(100),
});

const copySchema = z.object({
  targetProductId: z.string().uuid(),
  swap: z
    .object({ fromComponentId: z.string().uuid(), toComponentId: z.string().uuid() })
    .optional(),
});

const routingSchema = z.object({
  productId: z.string().uuid(),
  operations: z
    .array(
      z.object({
        sequence: z.number().int().positive(),
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(80),
        workCenterId: z.string().uuid(),
        setupMinutes: z.string().default("0"),
        runMinutes: z.string(),
      }),
    )
    .min(1)
    .max(30),
});

@Controller()
export class ManufacturingController {
  private get database() {
    return services().database;
  }

  @Get("work-centers")
  async listWorkCenters(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) => db.select().from(workCenters).orderBy(workCenters.code));
    return { data: rows.map(mapWorkCenter) };
  }

  @Post("work-centers")
  async createWorkCenter(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = workCenterSchema.parse(body);
    const [row] = await this.database.asUser(tenant, async (db) => {
      const [existing] = await db.select().from(workCenters).where(eq(workCenters.code, input.code)).limit(1);
      if (existing) throw new AppError("duplicate_code", "Ya existe una estación con esa clave.", 409);
      return db
        .insert(workCenters)
        .values({
          tenantId: tenant.tenantId,
          code: input.code,
          name: input.name,
          kind: input.kind,
          hourlyRateMinor: rate(input.hourlyRate),
          capacityHours: capacity(input.capacityHours),
          createdBy: tenant.userId,
        })
        .returning();
    });
    return mapWorkCenter(row);
  }

  @Patch("work-centers/:id")
  async updateWorkCenter(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = workCenterPatchSchema.parse(body);
    const row = await this.database.asUser(tenant, async (db) => {
      const center = await one(db, workCenters, workCenters.id, id, "No encontramos esa estación.");
      const [updated] = await db
        .update(workCenters)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.hourlyRate !== undefined ? { hourlyRateMinor: rate(input.hourlyRate) } : {}),
          ...(input.capacityHours !== undefined ? { capacityHours: capacity(input.capacityHours) } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(workCenters.id, center.id))
        .returning();
      return updated;
    });
    return mapWorkCenter(row);
  }

  @Get("boms")
  async listBoms(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => {
      const index = await loadBomIndex(db);
      const catalog = await loadProducts(db);
      const data = [];
      for (const [productId, bomId] of index.bomIdByProduct) {
        const product = catalog.get(productId);
        if (!product) continue;
        const [bom] = await db.select().from(boms).where(eq(boms.id, bomId)).limit(1);
        data.push({
          bomId,
          productId,
          sku: product.sku,
          name: product.name,
          version: bom?.version ?? 1,
          lines: index.lookup(productId)?.length ?? 0,
          materialCost: centsToMajor(unitCostMinor(productId, index, catalog)),
        });
      }
      return { data: data.sort((a, b) => a.sku.localeCompare(b.sku)) };
    });
  }

  @Get("boms/:productId")
  async getBom(@CurrentUser() actor: Actor, @Param("productId") productId: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, (db) => bomDetail(db, productId));
  }

  @Post("boms")
  async saveBom(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...ENGINEERING]);
    const input = bomSchema.parse(body);
    const lines: BomLine[] = input.lines.map((line) => {
      const quantity = parseQty(line.quantity);
      const scrapPct = parseQty(line.scrapPct);
      if (quantity <= 0n) throw new AppError("invalid_quantity", "Cada componente necesita cantidad mayor a cero.");
      if (scrapPct < 0n || scrapPct > 100n * QTY_SCALE) {
        throw new AppError("invalid_scrap", "La merma debe estar entre 0 y 100 %.");
      }
      return { componentId: line.componentProductId, quantity, scrapPct };
    });
    return this.database.asUser(tenant, async (db) => {
      await writeBom(db, tenant, input.productId, lines, input.notes ?? null);
      return bomDetail(db, input.productId);
    });
  }

  @Post("boms/:productId/copy")
  async copyBom(@CurrentUser() actor: Actor, @Param("productId") productId: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...ENGINEERING]);
    const input = copySchema.parse(body);
    return this.database.asUser(tenant, async (db) => {
      const index = await loadBomIndex(db);
      const source = index.lookup(productId);
      if (!source?.length) throw new AppError("bom_required", "El producto origen no tiene BOM activo.", 409);
      let swapped = false;
      const lines = source.map((line) => {
        if (input.swap && line.componentId === input.swap.fromComponentId) {
          swapped = true;
          return { ...line, componentId: input.swap.toComponentId };
        }
        return line;
      });
      if (input.swap && !swapped) {
        throw new AppError("swap_not_found", "El componente a reemplazar no está en el BOM origen.", 409);
      }
      await writeBom(db, tenant, input.targetProductId, lines, `Copiado del BOM de otro producto`);
      const routing = await activeRouting(db, productId);
      const [targetRouting] = await db
        .select()
        .from(routings)
        .where(and(eq(routings.productId, input.targetProductId), eq(routings.active, true)))
        .limit(1);
      if (routing && !targetRouting) {
        await writeRouting(
          db,
          tenant,
          input.targetProductId,
          routing.steps.map((step) => ({
            sequence: step.sequence,
            code: step.code,
            name: step.name,
            workCenterId: step.workCenterId,
            setupMinutes: step.setupMinutes,
            runMinutes: step.runMinutes,
          })),
        );
      }
      return bomDetail(db, input.targetProductId);
    });
  }

  @Post("products/:id/cost-from-bom")
  async costFromBom(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    return this.database.asUser(tenant, async (db) => {
      const detail = await bomDetail(db, id);
      const unit = BigInt(new Decimal(detail.unitCostMinor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      await db.update(products).set({ costMinor: unit, updatedAt: new Date() }).where(eq(products.id, id));
      await audit(db, tenant, "product.cost_rolled_up", "product", id, { costMinor: unit.toString() });
      return { productId: id, cost: minorToMajor(unit), materialCost: detail.materialCost, laborCost: detail.laborCost };
    });
  }

  @Get("routings/:productId")
  async getRouting(@CurrentUser() actor: Actor, @Param("productId") productId: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => {
      const routing = await activeRouting(db, productId);
      if (!routing) return { productId, routingId: null, version: null, operations: [] };
      return {
        productId,
        routingId: routing.id,
        version: routing.version,
        laborPerUnit: centsToMajor(laborPerUnitMinor(routing.steps)),
        operations: routing.steps.map((step) => ({
          sequence: step.sequence,
          code: step.code,
          name: step.name,
          workCenterId: step.workCenterId,
          workCenterName: step.workCenterName,
          setupMinutes: step.setupMinutes,
          runMinutes: step.runMinutes,
          hourlyRate: minorToMajor(step.hourlyRateMinor),
        })),
      };
    });
  }

  @Post("routings")
  async saveRouting(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...ENGINEERING]);
    const input = routingSchema.parse(body);
    const sequences = new Set(input.operations.map((op) => op.sequence));
    if (sequences.size !== input.operations.length) {
      throw new AppError("duplicate_sequence", "Dos operaciones tienen la misma secuencia.");
    }
    for (const op of input.operations) {
      if (new Decimal(op.setupMinutes).lt(0) || new Decimal(op.runMinutes).lt(0)) {
        throw new AppError("invalid_minutes", "Los minutos no pueden ser negativos.");
      }
    }
    await this.database.asUser(tenant, async (db) => {
      await one(db, products, products.id, input.productId, "No encontramos ese producto.");
      for (const op of input.operations) {
        await one(db, workCenters, workCenters.id, op.workCenterId, "No encontramos esa estación.");
      }
      await writeRouting(db, tenant, input.productId, input.operations);
    });
    return this.getRouting(actor, input.productId);
  }
}

async function writeBom(db: Db, tenant: TenantActor, productId: string, lines: BomLine[], notes: string | null) {
  const product = await one(db, products, products.id, productId, "No encontramos ese producto.");
  if (product.productType !== "finished_good" && product.productType !== "component") {
    throw new AppError("not_manufacturable", "Solo los terminados y componentes llevan BOM.", 409);
  }
  const ids = lines.map((line) => line.componentId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("duplicate_component", "Un componente aparece dos veces; suma las cantidades en una línea.");
  }
  if (ids.includes(product.id)) throw new AppError("bom_cycle", "Un producto no puede ser componente de sí mismo.", 409);
  for (const id of ids) {
    const component = await one(db, products, products.id, id, "No encontramos un componente.");
    if (component.productType === "service") {
      throw new AppError("invalid_component", "Los servicios no pueden ser componentes.", 409);
    }
  }
  const index = await loadBomIndex(db);
  if (createsBomCycle(product.id, ids, index.lookup)) {
    throw new AppError("bom_cycle", "Ese BOM crearía un ciclo: un componente ya usa este producto.", 409);
  }
  const [latest] = await db
    .select({ version: boms.version })
    .from(boms)
    .where(eq(boms.productId, product.id))
    .orderBy(desc(boms.version))
    .limit(1);
  await db.update(boms).set({ active: false }).where(and(eq(boms.productId, product.id), eq(boms.active, true)));
  const [bom] = await db
    .insert(boms)
    .values({
      tenantId: tenant.tenantId,
      productId: product.id,
      version: (latest?.version ?? 0) + 1,
      active: true,
      notes,
      createdBy: tenant.userId,
    })
    .returning();
  await db.insert(bomLines).values(
    lines.map((line, position) => ({
      tenantId: tenant.tenantId,
      bomId: bom.id,
      componentProductId: line.componentId,
      quantity: formatQty(line.quantity),
      scrapPct: formatQty(line.scrapPct),
      sequence: position + 1,
    })),
  );
  await audit(db, tenant, "bom.saved", "bom", bom.id, { productId: product.id, version: bom.version });
}

async function writeRouting(
  db: Db,
  tenant: TenantActor,
  productId: string,
  operations: Array<{ sequence: number; code: string; name: string; workCenterId: string; setupMinutes: string; runMinutes: string }>,
) {
  const [latest] = await db
    .select({ version: routings.version })
    .from(routings)
    .where(eq(routings.productId, productId))
    .orderBy(desc(routings.version))
    .limit(1);
  await db.update(routings).set({ active: false }).where(and(eq(routings.productId, productId), eq(routings.active, true)));
  const [routing] = await db
    .insert(routings)
    .values({ tenantId: tenant.tenantId, productId, version: (latest?.version ?? 0) + 1, active: true, createdBy: tenant.userId })
    .returning();
  await db.insert(routingOperations).values(
    operations.map((op) => ({
      tenantId: tenant.tenantId,
      routingId: routing.id,
      sequence: op.sequence,
      code: op.code.toUpperCase(),
      name: op.name,
      workCenterId: op.workCenterId,
      setupMinutes: new Decimal(op.setupMinutes).toFixed(2),
      runMinutes: new Decimal(op.runMinutes).toFixed(2),
    })),
  );
}

async function bomDetail(db: Db, productId: string) {
  const product = await one(db, products, products.id, productId, "No encontramos ese producto.");
  const index: BomIndex = await loadBomIndex(db);
  const catalog: Map<string, ProductInfo> = await loadProducts(db);
  const bomId = index.bomIdByProduct.get(product.id) ?? null;
  const [bom] = bomId ? await db.select().from(boms).where(eq(boms.id, bomId)).limit(1) : [];
  const routing = await activeRouting(db, product.id);
  const lines = (index.lookup(product.id) ?? []).map((line) => {
    const component = catalog.get(line.componentId);
    const perUnit = lineRequirement(QTY_SCALE, line);
    const unit = unitCostMinor(line.componentId, index, catalog);
    return {
      componentProductId: line.componentId,
      sku: component?.sku ?? "",
      name: component?.name ?? "",
      stockUom: component?.stockUom ?? "EA",
      hasBom: Boolean(index.lookup(line.componentId)?.length),
      quantity: formatQty(line.quantity),
      scrapPct: formatQty(line.scrapPct),
      requiredPerUnit: formatQty(perUnit),
      extendedCost: minorToMajor(extendCostMinor(perUnit, unit)),
    };
  });
  const material = bomId ? unitCostMinor(product.id, index, catalog) : new Decimal(0);
  const labor = routing ? laborPerUnitMinor(routing.steps) : new Decimal(0);
  const total = material.add(labor);
  const currentCost = product.costMinor === null ? null : Money.fromMinor(BigInt(product.costMinor)).toMajor();
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    bomId,
    version: bom?.version ?? null,
    notes: bom?.notes ?? null,
    lines,
    materialCost: centsToMajor(material),
    laborCost: centsToMajor(labor),
    unitCost: centsToMajor(total),
    unitCostMinor: total.toFixed(6),
    currentCost,
    routingId: routing?.id ?? null,
  };
}

function mapWorkCenter(row: {
  id: string;
  code: string;
  name: string;
  kind: string;
  hourlyRateMinor: bigint;
  capacityHours: string;
  active: boolean;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    hourlyRate: minorToMajor(row.hourlyRateMinor),
    capacityHours: String(row.capacityHours),
    active: row.active,
  };
}

function rate(value: string): bigint {
  const minor = Money.fromMajor(value).minor;
  if (minor < 0n) throw new AppError("invalid_money", "La tarifa no puede ser negativa.");
  return minor;
}

function capacity(value: string): string {
  const hours = new Decimal(value);
  if (hours.lte(0) || hours.gt(24)) throw new AppError("invalid_capacity", "La capacidad va de 0 a 24 horas.");
  return hours.toFixed(2);
}
