import { createHash } from "node:crypto";
import {
  canApproveNegativeStock,
  extendCostMinor,
  formatQty,
  maxQty,
  qtyFromDb,
  stockUnitCostMinor,
} from "@3dprintmty/domain";
import { AppError, type Result } from "@3dprintmty/shared";
import { and, eq, sql } from "drizzle-orm";
import type { DatabaseService } from "../db/database.service";
import {
  auditEvents,
  idempotencyKeys,
  locations,
  numberSequences,
  products,
  stockBalances,
  stockLedgers,
} from "../db/schema";
import type { TenantActor } from "../http/actor";

export type Db = any;

export async function one(db: Db, table: { id: unknown }, idColumn: unknown, id: string, message: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", message, 404);
  const [row] = await db.select().from(table as never).where(eq(idColumn as never, id)).limit(1);
  if (!row) throw new AppError("not_found", message, 404);
  return row;
}

export async function allocateFolio(database: DatabaseService, tenantId: string, docType: string, series: string) {
  return allocateFolios(database, tenantId, docType, series, 1);
}

/**
 * Reserva `count` folios consecutivos y regresa el primero.
 * Llamar fuera de `asUser`: con PGlite una consulta admin dentro de la transacción se bloquea.
 */
export async function allocateFolios(
  database: DatabaseService,
  tenantId: string,
  docType: string,
  series: string,
  count: number,
): Promise<number> {
  if (count < 1) return 0;
  const step = BigInt(count);
  const row = (await database.asAdmin((db) =>
    db
      .insert(numberSequences)
      .values({ tenantId, docType, series, nextFolio: 1n + step })
      .onConflictDoUpdate({
        target: [numberSequences.tenantId, numberSequences.docType, numberSequences.series],
        set: { nextFolio: sql`${numberSequences.nextFolio} + ${step}`, updatedAt: new Date() },
      })
      .returning({ nextFolio: numberSequences.nextFolio }),
  )) as Array<{ nextFolio: bigint }>;
  const next = row[0]?.nextFolio;
  if (next === undefined) throw new AppError("internal_error", "No se pudo asignar el folio.", 500);
  return Number(next) - count;
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export async function withIdempotency<T>(
  database: DatabaseService,
  userId: string,
  key: string | undefined,
  payload: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) return fn();
  if (key.length > 80) {
    throw new AppError("invalid_idempotency_key", "La llave de idempotencia es demasiado larga.");
  }
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const [existing] = await database.asAdmin((db) =>
    db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
      .limit(1),
  );
  if (existing) {
    if (existing.requestHash !== hash) {
      throw new AppError("idempotency_conflict", "Esa llave ya se usó con otros datos.", 409);
    }
    return existing.response as T;
  }
  const response = await fn();
  await database.asAdmin((db) =>
    db.insert(idempotencyKeys).values({ userId, key, requestHash: hash, response: toJson(response) }),
  );
  return response;
}

function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)));
}

export async function audit(
  db: Db,
  tenant: TenantActor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(auditEvents).values({
    tenantId: tenant.tenantId,
    actorUserId: tenant.userId,
    action,
    entityType,
    entityId,
    metadata,
  });
}

export async function defaultLocationId(db: Db): Promise<string> {
  const rows = await db.select().from(locations);
  const found = rows.find((row: { isDefault: boolean }) => row.isDefault) ?? rows[0];
  if (!found) throw new AppError("location_required", "Da de alta una sucursal primero.", 409);
  return found.id;
}

async function loadBalance(db: Db, productId: string, locationId: string) {
  const [balance] = await db
    .select()
    .from(stockBalances)
    .where(and(eq(stockBalances.productId, productId), eq(stockBalances.locationId, locationId)))
    .limit(1);
  return balance ?? null;
}

async function saveBalance(
  db: Db,
  tenant: TenantActor,
  productId: string,
  locationId: string,
  balance: { id: string } | null,
  values: Record<string, unknown>,
) {
  if (balance) {
    await db.update(stockBalances).set({ ...values, updatedAt: new Date() }).where(eq(stockBalances.id, balance.id));
    return;
  }
  await db.insert(stockBalances).values({
    tenantId: tenant.tenantId,
    productId,
    locationId,
    onHand: "0",
    allocated: "0",
    createdBy: tenant.userId,
    ...values,
  });
}

/** Valor en centavos de `quantity` (unidad de almacén) al costo vigente del producto. */
export async function stockValueMinor(db: Db, productId: string, quantity: bigint): Promise<bigint> {
  const [product] = await db
    .select({ costMinor: products.costMinor, uomFactor: products.uomFactor })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) return 0n;
  const unit = stockUnitCostMinor(product.costMinor === null ? null : BigInt(product.costMinor), String(product.uomFactor));
  return extendCostMinor(quantity, unit);
}

export interface StockPosting {
  productId: string;
  locationId: string;
  kind: "receipt" | "issue" | "adjustment" | "scrap" | "transfer";
  /** Cambio firmado en existencia (escala de cantidad). */
  delta: bigint;
  reason: string;
  /** Apartado que se libera con esta salida (consumo de una OP). */
  releaseAllocated?: bigint;
  allowNegative?: boolean;
  valueMinor?: bigint;
  reference?: { type: string; id: string };
  lotId?: string | null;
  reorderPoint?: bigint;
  leadTimeDays?: number;
}

/** Toda entrada o salida pasa por aquí: actualiza la existencia y deja el renglón en el kardex. */
export async function postStock(db: Db, tenant: TenantActor, input: StockPosting): Promise<void> {
  if (input.delta === 0n && input.reorderPoint === undefined && input.leadTimeDays === undefined) return;
  const balance = await loadBalance(db, input.productId, input.locationId);
  const onHand = balance ? qtyFromDb(balance.onHand) : 0n;
  const allocated = balance ? qtyFromDb(balance.allocated) : 0n;
  const next = onHand + input.delta;
  const allowNegative = input.allowNegative ?? canApproveNegativeStock(tenant.role);
  if (input.delta < 0n && input.allowNegative !== true) {
    const taken = -input.delta;
    const release = input.releaseAllocated ?? 0n;
    const covered = release > taken ? taken : release;
    const fromFree = taken - covered;
    if (fromFree > onHand - allocated) {
      throw new AppError(
        "reserved_stock",
        "Esa salida usa material apartado para un pedido. Libera el apartado antes de sacarlo.",
        409,
      );
    }
  }
  if (next < 0n && !allowNegative) {
    throw new AppError(
      "negative_stock",
      "Esa salida dejaría el inventario en negativo. Pide aprobación de un administrador.",
      409,
    );
  }
  await saveBalance(db, tenant, input.productId, input.locationId, balance, {
    onHand: formatQty(next),
    allocated: formatQty(maxQty(0n, allocated - (input.releaseAllocated ?? 0n))),
    ...(input.reorderPoint !== undefined ? { reorderPoint: formatQty(input.reorderPoint) } : {}),
    ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
  });
  if (input.delta === 0n) return;
  const value = input.valueMinor ?? (await stockValueMinor(db, input.productId, input.delta < 0n ? -input.delta : input.delta));
  await db.insert(stockLedgers).values({
    tenantId: tenant.tenantId,
    productId: input.productId,
    locationId: input.locationId,
    kind: input.kind,
    quantity: formatQty(input.delta),
    reason: input.reason,
    valueMinor: input.delta < 0n ? -value : value,
    referenceType: input.reference?.type ?? null,
    referenceId: input.reference?.id ?? null,
    lotId: input.lotId ?? null,
    createdBy: tenant.userId,
  });
}

/** Aparta (qty > 0) o libera (qty < 0) material sin mover la existencia física. */
export async function reserveStock(
  db: Db,
  tenant: TenantActor,
  input: { productId: string; locationId: string; quantity: bigint; reason: string; reference: { type: string; id: string } },
): Promise<void> {
  if (input.quantity === 0n) return;
  const balance = await loadBalance(db, input.productId, input.locationId);
  const allocated = balance ? qtyFromDb(balance.allocated) : 0n;
  await saveBalance(db, tenant, input.productId, input.locationId, balance, {
    allocated: formatQty(maxQty(0n, allocated + input.quantity)),
  });
  await db.insert(stockLedgers).values({
    tenantId: tenant.tenantId,
    productId: input.productId,
    locationId: input.locationId,
    kind: input.quantity > 0n ? "reservation" : "release",
    quantity: formatQty(input.quantity),
    reason: input.reason,
    valueMinor: 0n,
    referenceType: input.reference.type,
    referenceId: input.reference.id,
    createdBy: tenant.userId,
  });
}

export async function availableAt(db: Db, productId: string, locationId: string): Promise<bigint> {
  const balance = await loadBalance(db, productId, locationId);
  if (!balance) return 0n;
  return qtyFromDb(balance.onHand) - qtyFromDb(balance.allocated);
}

export function minorToMajor(value: bigint | number | string): string {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
