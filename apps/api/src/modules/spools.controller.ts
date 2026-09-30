import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import {
  formatQty,
  parseQty,
  QTY_SCALE,
  qtyFromDb,
  SPOOL_EMPTY_THRESHOLD_G,
  type SpoolState,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import { filaments, locations, spoolEvents, spools } from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { allocateFolios, defaultLocationId, one, postStock, type Db } from "./support";

const WAREHOUSE = ["owner", "admin", "warehouse"] as const;

const spoolSchema = z.object({
  filamentId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  grams: z.string(),
  count: z.coerce.number().int().min(1, "La cantidad de rollos debe ser al menos 1.").max(50, "Registra máximo 50 rollos a la vez.").default(1),
  notes: z.string().trim().max(200).optional(),
  addToStock: z.boolean().default(true),
});

const weighSchema = z.object({
  grams: z.string(),
  reason: z.string().trim().max(160).optional(),
});

const scrapSchema = z.object({ reason: z.string().trim().min(3).max(160) });

const emptySchema = z.object({
  spoolIds: z.array(z.string().uuid()).min(1, "Elige al menos un rollo.").max(200, "Elige máximo 200 rollos a la vez."),
  reason: z.string().trim().max(160).optional(),
});

@Controller()
export class SpoolsController {
  private get database() {
    return services().database;
  }

  @Get("spools")
  async list(@CurrentUser() actor: Actor, @Query("filamentId") filamentId?: string) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: spools.id,
          spoolNumber: spools.spoolNumber,
          filamentId: spools.filamentId,
          sku: filaments.sku,
          name: filaments.name,
          material: filaments.material,
          color: filaments.color,
          locationId: spools.locationId,
          locationName: locations.name,
          initialGrams: spools.initialGrams,
          currentGrams: spools.currentGrams,
          status: spools.status,
          notes: spools.notes,
          createdAt: spools.createdAt,
        })
        .from(spools)
        .innerJoin(filaments, eq(filaments.id, spools.filamentId))
        .innerJoin(locations, eq(locations.id, spools.locationId))
        .where(filamentId ? eq(spools.filamentId, filamentId) : undefined)
        .orderBy(desc(spools.createdAt)),
    );
    return { data: rows.map((row: SpoolRow) => mapSpool(row)) };
  }

  @Post("spools")
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...WAREHOUSE]);
    const input = spoolSchema.parse(body);
    const grams = positive(input.grams, "El peso del rollo debe ser mayor a cero.");
    const first = await allocateFolios(this.database, tenant.tenantId, "spool", "R", input.count);
    const created = await this.database.asUser(tenant, async (db) => {
      const filament = await one(db, filaments, filaments.id, input.filamentId, "No encontramos ese filamento.");
      if (filament.status !== "active") {
        throw new AppError("filament_inactive", "Ese filamento no está activo.", 409);
      }
      const locationId = input.locationId
        ? (await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.")).id
        : await defaultLocationId(db);
      const rows = [];
      for (let position = 0; position < input.count; position += 1) {
        const spoolNumber = `R-${first + position}`;
        const [spool] = await db
          .insert(spools)
          .values({
            tenantId: tenant.tenantId,
            spoolNumber,
            filamentId: filament.id,
            locationId,
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
            filamentId: filament.id,
            locationId,
            kind: "receipt",
            delta: grams,
            reason: `Alta de rollo ${spoolNumber}`,
            reference: { type: "spool", id: spool.id },
          });
        }
        rows.push({ ...spool, sku: filament.sku, name: filament.name, material: filament.material, color: filament.color });
      }
      return rows;
    });
    return { data: created.map((row: SpoolRow) => mapSpool(row)) };
  }

  @Post("spools/:id/weigh")
  async weigh(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse", "production"]);
    const input = weighSchema.parse(body);
    const measured = parseQty(input.grams);
    if (measured < 0n) throw new AppError("invalid_quantity", "El peso no puede ser negativo.");
    const reason = input.reason || (measured === 0n ? "Rollo terminado" : "Pesaje del rollo");
    const updated = await this.database.asUser(tenant, async (db) =>
      weighSpool(db, tenant, await openSpool(db, id), measured, reason),
    );
    return mapSpool(updated);
  }

  @Post("spools/empty")
  async empty(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse", "production"]);
    const input = emptySchema.parse(body);
    const ids = [...new Set(input.spoolIds)];
    const updated = await this.database.asUser(tenant, async (db) => {
      const rows = [];
      for (const id of ids) {
        rows.push(await weighSpool(db, tenant, await openSpool(db, id), 0n, input.reason || "Rollo terminado"));
      }
      return rows;
    });
    return { data: updated.map((row: SpoolRow) => mapSpool(row)) };
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
          filamentId: spool.filamentId,
          locationId: spool.locationId,
          kind: "scrap",
          delta: -remaining,
          reason: `Merma de ${spool.spoolNumber}: ${input.reason}`,
          reference: { type: "spool", id: spool.id },
          allowNegative: true,
        });
      }
      const [filament] = await db
        .select({ sku: filaments.sku, name: filaments.name, material: filaments.material, color: filaments.color })
        .from(filaments)
        .where(eq(filaments.id, spool.filamentId))
        .limit(1);
      return { ...row, ...filament };
    });
    return mapSpool(updated);
  }

  @Delete("spools/:id")
  async remove(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, [...WAREHOUSE]);
    await this.database.asUser(tenant, async (db) => {
      const spool = await one(db, spools, spools.id, id, "No encontramos ese rollo.");
      const remaining = qtyFromDb(spool.currentGrams);
      if (remaining > 0n) {
        await postStock(db, tenant, {
          filamentId: spool.filamentId,
          locationId: spool.locationId,
          kind: "adjustment",
          delta: -remaining,
          reason: `Se borró el rollo ${spool.spoolNumber}`,
          reference: { type: "spool", id: spool.id },
          allowNegative: true,
        });
      }
      await db.delete(spoolEvents).where(eq(spoolEvents.spoolId, spool.id));
      await db.delete(spools).where(eq(spools.id, spool.id));
    });
    return { ok: true };
  }
}

interface SpoolRow {
  id: string;
  spoolNumber: string;
  filamentId: string;
  sku?: string;
  name?: string;
  material?: string | null;
  color?: string | null;
  locationId: string;
  locationName?: string;
  initialGrams: string;
  currentGrams: string;
  status: string;
  notes: string | null;
  createdAt: Date;
}

function mapSpool(row: SpoolRow) {
  const initial = qtyFromDb(row.initialGrams);
  const current = qtyFromDb(row.currentGrams);
  return {
    id: row.id,
    spoolNumber: row.spoolNumber,
    filamentId: row.filamentId,
    sku: row.sku ?? null,
    name: row.name ?? null,
    material: row.material ?? null,
    color: row.color ?? null,
    locationId: row.locationId,
    locationName: row.locationName ?? null,
    initialGrams: formatQty(initial),
    currentGrams: formatQty(current),
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

async function weighSpool(db: Db, tenant: TenantActor, spool: SpoolRecord, measured: bigint, reason: string) {
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
      reason,
      createdBy: tenant.userId,
    });
    await postStock(db, tenant, {
      filamentId: spool.filamentId,
      locationId: spool.locationId,
      kind: "adjustment",
      delta,
      reason: `Pesaje de ${spool.spoolNumber}: ${reason}`,
      reference: { type: "spool", id: spool.id },
      allowNegative: true,
    });
  }
  const [filament] = await db
    .select({ sku: filaments.sku, name: filaments.name, material: filaments.material, color: filaments.color })
    .from(filaments)
    .where(eq(filaments.id, spool.filamentId))
    .limit(1);
  return { ...row, ...filament };
}

type SpoolRecord = typeof spools.$inferSelect;

async function openSpool(db: Db, id: string): Promise<SpoolRecord> {
  const spool = await one(db, spools, spools.id, id, "No encontramos ese rollo.");
  if (spool.status === "scrapped") {
    throw new AppError("spool_closed", "Ese rollo ya se dio de baja.", 409);
  }
  return spool;
}
