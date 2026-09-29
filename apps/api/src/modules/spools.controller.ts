import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  formatQty,
  parseQty,
  QTY_SCALE,
  qtyFromDb,
  SPOOL_EMPTY_THRESHOLD_G,
  type SpoolState,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  cycleCountLines,
  cycleCounts,
  locations,
  materialLots,
  products,
  spoolEvents,
  spools,
  stockBalances,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import {
  allocateFolio,
  audit,
  defaultLocationId,
  minorToMajor,
  one,
  postStock,
  stockValueMinor,
  type Db,
} from "./support";

const WAREHOUSE = ["owner", "admin", "warehouse"] as const;

const spoolSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  grams: z.string(),
  lotNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(200).optional(),
  addToStock: z.boolean().default(true),
});

const weighSchema = z.object({
  grams: z.string(),
  reason: z.string().trim().min(3).max(160),
});

const scrapSchema = z.object({ reason: z.string().trim().min(3).max(160) });

const countSchema = z.object({
  locationId: z.string().uuid(),
  reference: z.string().trim().min(1).max(80),
  dryRun: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        countedQty: z.string(),
        reason: z.string().trim().max(160).optional(),
      }),
    )
    .min(1)
    .max(500),
});

@Controller()
export class SpoolsController {
  private get database() {
    return services().database;
  }

  @Get("spools")
  async list(@CurrentUser() actor: Actor, @Query("status") status?: string, @Query("productId") productId?: string) {
    const tenant = requireTenant(actor);
    const filters = [
      status ? eq(spools.status, status) : undefined,
      productId ? eq(spools.productId, productId) : undefined,
    ].filter(Boolean);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: spools.id,
          spoolNumber: spools.spoolNumber,
          productId: spools.productId,
          sku: products.sku,
          name: products.name,
          material: products.material,
          color: products.color,
          locationId: spools.locationId,
          locationName: locations.name,
          lotId: spools.lotId,
          lotNumber: materialLots.lotNumber,
          initialGrams: spools.initialGrams,
          currentGrams: spools.currentGrams,
          status: spools.status,
          notes: spools.notes,
          createdAt: spools.createdAt,
        })
        .from(spools)
        .innerJoin(products, eq(products.id, spools.productId))
        .innerJoin(locations, eq(locations.id, spools.locationId))
        .leftJoin(materialLots, eq(materialLots.id, spools.lotId))
        .where(filters.length ? and(...(filters as never[])) : undefined)
        .orderBy(desc(spools.createdAt)),
    );
    return { data: rows.map(mapSpool) };
  }

  @Get("spools/:id")
  async get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => {
      const spool = await one(db, spools, spools.id, id, "No encontramos ese rollo.");
      const events = await db
        .select()
        .from(spoolEvents)
        .where(eq(spoolEvents.spoolId, spool.id))
        .orderBy(desc(spoolEvents.createdAt));
      return {
        ...mapSpool(spool),
        events: events.map((event: SpoolEventRow) => ({
          id: event.id,
          kind: event.kind,
          grams: formatQty(qtyFromDb(event.grams)),
          reason: event.reason,
          productionOrderId: event.productionOrderId,
          createdAt: event.createdAt,
        })),
      };
    });
  }

  @Post("spools")
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...WAREHOUSE]);
    const input = spoolSchema.parse(body);
    const grams = positive(input.grams, "El peso del rollo debe ser mayor a cero.");
    const folio = await allocateFolio(this.database, tenant.tenantId, "spool", "R");
    const created = await this.database.asUser(tenant, async (db) => {
      const product = await filamentProduct(db, input.productId);
      const locationId = input.locationId
        ? (await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.")).id
        : await defaultLocationId(db);
      const lotId = input.lotNumber ? await ensureLot(db, tenant, product.id, input.lotNumber, grams) : null;
      const [spool] = await db
        .insert(spools)
        .values({
          tenantId: tenant.tenantId,
          spoolNumber: `R-${folio}`,
          productId: product.id,
          locationId,
          lotId,
          initialGrams: formatQty(grams),
          currentGrams: formatQty(grams),
          status: "available",
          notes: input.notes ?? null,
          createdBy: tenant.userId,
        })
        .returning();
      await db.insert(spoolEvents).values({
        tenantId: tenant.tenantId,
        spoolId: spool.id,
        kind: "receipt",
        grams: formatQty(grams),
        reason: input.addToStock ? "Alta de rollo con entrada a inventario" : "Alta de rollo ya contado en inventario",
        createdBy: tenant.userId,
      });
      if (input.addToStock) {
        await postStock(db, tenant, {
          productId: product.id,
          locationId,
          kind: "receipt",
          delta: grams,
          reason: `Alta de rollo R-${folio}`,
          reference: { type: "spool", id: spool.id },
          lotId,
        });
      }
      return spool;
    });
    return mapSpool(created);
  }

  @Post("spools/:id/weigh")
  async weigh(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse", "production"]);
    const input = weighSchema.parse(body);
    const measured = parseQty(input.grams);
    if (measured < 0n) throw new AppError("invalid_quantity", "El peso no puede ser negativo.");
    const updated = await this.database.asUser(tenant, async (db) => {
      const spool = await openSpool(db, id);
      const current = qtyFromDb(spool.currentGrams);
      const delta = measured - current;
      const status: SpoolState =
        measured < SPOOL_EMPTY_THRESHOLD_G * QTY_SCALE
          ? "empty"
          : spool.status === "available" && measured === qtyFromDb(spool.initialGrams)
            ? "available"
            : "in_use";
      const [row] = await db
        .update(spools)
        .set({ currentGrams: formatQty(measured), status, updatedAt: new Date() })
        .where(eq(spools.id, spool.id))
        .returning();
      if (delta !== 0n) {
        await db.insert(spoolEvents).values({
          tenantId: tenant.tenantId,
          spoolId: spool.id,
          kind: "adjust",
          grams: formatQty(delta),
          reason: input.reason,
          createdBy: tenant.userId,
        });
        await postStock(db, tenant, {
          productId: spool.productId,
          locationId: spool.locationId,
          kind: "adjustment",
          delta,
          reason: `Pesaje de ${spool.spoolNumber}: ${input.reason}`,
          reference: { type: "spool", id: spool.id },
          lotId: spool.lotId,
          allowNegative: true,
        });
      }
      return row;
    });
    return mapSpool(updated);
  }

  @Post("spools/:id/scrap")
  async scrap(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...WAREHOUSE]);
    const input = scrapSchema.parse(body);
    const updated = await this.database.asUser(tenant, async (db) => {
      const spool = await openSpool(db, id);
      const remaining = qtyFromDb(spool.currentGrams);
      const [row] = await db
        .update(spools)
        .set({ currentGrams: "0", status: "scrapped", updatedAt: new Date() })
        .where(eq(spools.id, spool.id))
        .returning();
      if (remaining > 0n) {
        await db.insert(spoolEvents).values({
          tenantId: tenant.tenantId,
          spoolId: spool.id,
          kind: "scrap",
          grams: formatQty(-remaining),
          reason: input.reason,
          createdBy: tenant.userId,
        });
        await postStock(db, tenant, {
          productId: spool.productId,
          locationId: spool.locationId,
          kind: "scrap",
          delta: -remaining,
          reason: `Merma de ${spool.spoolNumber}: ${input.reason}`,
          reference: { type: "spool", id: spool.id },
          lotId: spool.lotId,
          allowNegative: true,
        });
      }
      await audit(db, tenant, "spool.scrapped", "spool", spool.id, { grams: formatQty(remaining), reason: input.reason });
      return row;
    });
    return mapSpool(updated);
  }

  @Get("lots")
  async lots(@CurrentUser() actor: Actor, @Query("productId") productId?: string) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: materialLots.id,
          lotNumber: materialLots.lotNumber,
          vendorLot: materialLots.vendorLot,
          source: materialLots.source,
          productId: materialLots.productId,
          sku: products.sku,
          name: products.name,
          receivedQty: materialLots.receivedQty,
          receivedAt: materialLots.receivedAt,
          purchaseOrderId: materialLots.purchaseOrderId,
        })
        .from(materialLots)
        .innerJoin(products, eq(products.id, materialLots.productId))
        .where(productId ? eq(materialLots.productId, productId) : undefined)
        .orderBy(desc(materialLots.receivedAt)),
    );
    return {
      data: rows.map((row: { receivedQty: string }) => ({ ...row, receivedQty: formatQty(qtyFromDb(row.receivedQty)) })),
    };
  }

  @Get("cycle-counts")
  async counts(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: cycleCounts.id,
          folio: cycleCounts.folio,
          reference: cycleCounts.reference,
          locationName: locations.name,
          adjustments: cycleCounts.adjustments,
          varianceValueMinor: cycleCounts.varianceValueMinor,
          createdAt: cycleCounts.createdAt,
        })
        .from(cycleCounts)
        .innerJoin(locations, eq(locations.id, cycleCounts.locationId))
        .orderBy(desc(cycleCounts.createdAt)),
    );
    return {
      data: rows.map(({ varianceValueMinor, ...row }: { varianceValueMinor: bigint }) => ({
        ...row,
        varianceValue: minorToMajor(varianceValueMinor),
      })),
    };
  }

  @Get("cycle-counts/:id")
  async count(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => {
      const header = await one(db, cycleCounts, cycleCounts.id, id, "No encontramos ese conteo.");
      const lines = await db
        .select({
          productId: cycleCountLines.productId,
          sku: products.sku,
          name: products.name,
          stockUom: products.stockUom,
          systemQty: cycleCountLines.systemQty,
          countedQty: cycleCountLines.countedQty,
          variance: cycleCountLines.variance,
          reason: cycleCountLines.reason,
          valueMinor: cycleCountLines.valueMinor,
        })
        .from(cycleCountLines)
        .innerJoin(products, eq(products.id, cycleCountLines.productId))
        .where(eq(cycleCountLines.cycleCountId, header.id));
      return {
        id: header.id,
        folio: header.folio,
        reference: header.reference,
        adjustments: header.adjustments,
        varianceValue: minorToMajor(header.varianceValueMinor),
        createdAt: header.createdAt,
        lines: lines.map((line: CountLineRow) => ({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          stockUom: line.stockUom,
          systemQty: formatQty(qtyFromDb(line.systemQty)),
          countedQty: formatQty(qtyFromDb(line.countedQty)),
          variance: formatQty(qtyFromDb(line.variance)),
          reason: line.reason,
          value: minorToMajor(line.valueMinor),
        })),
      };
    });
  }

  @Post("cycle-counts")
  async createCount(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...WAREHOUSE]);
    const input = countSchema.parse(body);
    const seen = new Set<string>();
    const counted = input.lines.map((line) => {
      if (seen.has(line.productId)) {
        throw new AppError("duplicate_line", "Un producto aparece dos veces en el conteo.");
      }
      seen.add(line.productId);
      const qty = parseQty(line.countedQty);
      if (qty < 0n) throw new AppError("invalid_quantity", "La cantidad contada no puede ser negativa.");
      return { ...line, qty };
    });
    const folio = input.dryRun ? 0 : await allocateFolio(this.database, tenant.tenantId, "cycle_count", "CC");
    return this.database.asUser(tenant, async (db) => {
      const location = await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.");
      const preview = [];
      for (const line of counted) {
        const product = await one(db, products, products.id, line.productId, "No encontramos ese producto.");
        const [balance] = await db
          .select()
          .from(stockBalances)
          .where(and(eq(stockBalances.productId, product.id), eq(stockBalances.locationId, location.id)))
          .limit(1);
        const system = balance ? qtyFromDb(balance.onHand) : 0n;
        const variance = line.qty - system;
        const magnitude = await stockValueMinor(db, product.id, variance < 0n ? -variance : variance);
        preview.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          stockUom: product.stockUom,
          system,
          counted: line.qty,
          variance,
          valueMinor: variance < 0n ? -magnitude : magnitude,
          reason: line.reason?.trim() || (variance === 0n ? "Sin diferencia" : "Diferencia de conteo"),
        });
      }
      const adjustments = preview.filter((line) => line.variance !== 0n);
      const totalValue = preview.reduce((sum, line) => sum + line.valueMinor, 0n);
      const summary = {
        dryRun: input.dryRun,
        adjustments: adjustments.length,
        varianceValue: minorToMajor(totalValue),
        lines: preview.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          stockUom: line.stockUom,
          systemQty: formatQty(line.system),
          countedQty: formatQty(line.counted),
          variance: formatQty(line.variance),
          value: minorToMajor(line.valueMinor),
          reason: line.reason,
        })),
      };
      if (input.dryRun) return { ...summary, id: null, folio: null };

      const [header] = await db
        .insert(cycleCounts)
        .values({
          tenantId: tenant.tenantId,
          folio: `CC-${folio}`,
          locationId: location.id,
          reference: input.reference,
          adjustments: adjustments.length,
          varianceValueMinor: totalValue,
          createdBy: tenant.userId,
        })
        .returning();
      await db.insert(cycleCountLines).values(
        preview.map((line) => ({
          tenantId: tenant.tenantId,
          cycleCountId: header.id,
          productId: line.productId,
          systemQty: formatQty(line.system),
          countedQty: formatQty(line.counted),
          variance: formatQty(line.variance),
          reason: line.reason,
          valueMinor: line.valueMinor,
        })),
      );
      for (const line of adjustments) {
        await postStock(db, tenant, {
          productId: line.productId,
          locationId: location.id,
          kind: "adjustment",
          delta: line.variance,
          reason: `Conteo ${header.folio}: ${line.reason}`,
          valueMinor: line.valueMinor < 0n ? -line.valueMinor : line.valueMinor,
          reference: { type: "cycle_count", id: header.id },
          allowNegative: true,
        });
      }
      await audit(db, tenant, "cycle_count.posted", "cycle_count", header.id, {
        adjustments: adjustments.length,
        varianceMinor: totalValue.toString(),
      });
      return { ...summary, id: header.id, folio: header.folio };
    });
  }
}

interface SpoolRow {
  id: string;
  spoolNumber: string;
  productId: string;
  sku?: string;
  name?: string;
  material?: string | null;
  color?: string | null;
  locationId: string;
  locationName?: string;
  lotId: string | null;
  lotNumber?: string | null;
  initialGrams: string;
  currentGrams: string;
  status: string;
  notes: string | null;
  createdAt: Date;
}

interface SpoolEventRow {
  id: string;
  kind: string;
  grams: string;
  reason: string;
  productionOrderId: string | null;
  createdAt: Date;
}

interface CountLineRow {
  productId: string;
  sku: string;
  name: string;
  stockUom: string;
  systemQty: string;
  countedQty: string;
  variance: string;
  reason: string;
  valueMinor: bigint;
}

export function mapSpool(row: SpoolRow) {
  const initial = qtyFromDb(row.initialGrams);
  const current = qtyFromDb(row.currentGrams);
  return {
    id: row.id,
    spoolNumber: row.spoolNumber,
    productId: row.productId,
    sku: row.sku ?? null,
    name: row.name ?? null,
    material: row.material ?? null,
    color: row.color ?? null,
    locationId: row.locationId,
    locationName: row.locationName ?? null,
    lotId: row.lotId,
    lotNumber: row.lotNumber ?? null,
    initialGrams: formatQty(initial),
    currentGrams: formatQty(current),
    percentRemaining: initial > 0n ? Number((current * 100n) / initial) : 0,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function positive(value: string, message: string): bigint {
  const qty = parseQty(value);
  if (qty <= 0n) throw new AppError("invalid_quantity", message);
  return qty;
}

async function filamentProduct(db: Db, productId: string) {
  const product = await one(db, products, products.id, productId, "No encontramos ese producto.");
  if (product.stockUom !== "G") {
    throw new AppError("not_filament", "Solo los filamentos (en gramos) se manejan por rollo.", 409);
  }
  return product;
}

async function openSpool(db: Db, id: string) {
  const spool = await one(db, spools, spools.id, id, "No encontramos ese rollo.");
  if (spool.status === "scrapped") {
    throw new AppError("spool_closed", "Ese rollo ya se dio de baja.", 409);
  }
  return spool;
}

export async function ensureLot(
  db: Db,
  tenant: TenantActor,
  productId: string,
  lotNumber: string,
  receivedQty: bigint,
  extra: { source?: "manual" | "purchase"; vendorLot?: string | null; vendorId?: string; purchaseOrderId?: string; receiptId?: string } = {},
): Promise<string> {
  const [existing] = await db.select().from(materialLots).where(eq(materialLots.lotNumber, lotNumber)).limit(1);
  if (existing) {
    if (existing.productId !== productId) {
      throw new AppError("lot_conflict", "Ese número de lote ya existe para otro producto.", 409);
    }
    await db
      .update(materialLots)
      .set({ receivedQty: formatQty(qtyFromDb(existing.receivedQty) + receivedQty) })
      .where(eq(materialLots.id, existing.id));
    return existing.id;
  }
  const [lot] = await db
    .insert(materialLots)
    .values({
      tenantId: tenant.tenantId,
      productId,
      lotNumber,
      vendorLot: extra.vendorLot ?? null,
      source: extra.source ?? "manual",
      receivedQty: formatQty(receivedQty),
      vendorId: extra.vendorId ?? null,
      purchaseOrderId: extra.purchaseOrderId ?? null,
      receiptId: extra.receiptId ?? null,
      createdBy: tenant.userId,
    })
    .returning();
  return lot.id;
}
