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
  idempotencyRequests,
  filaments,
  locations,
  materialLots,
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
  actor: TenantActor,
  key: string | undefined,
  payload: { route: string; [field: string]: unknown },
  fn: () => Promise<T>,
  options: { required?: boolean } = {},
): Promise<T> {
  if (!key) {
    if (options.required !== false) throw new AppError("idempotency_key_required", "Falta la llave de idempotencia.");
    return fn();
  }
  if (key.trim().length === 0 || key.length > 80) {
    throw new AppError("invalid_idempotency_key", "La llave de idempotencia debe tener entre 1 y 80 caracteres.");
  }
  const hash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  return database.atomic(async () => {
    const match = and(eq(idempotencyRequests.tenantId, actor.tenantId),
      eq(idempotencyRequests.userId, actor.userId), eq(idempotencyRequests.operation, payload.route),
      eq(idempotencyRequests.key, key));
    // El bloqueo se conserva hasta el commit que incluye tanto el efecto como la respuesta.
    if (database.driver === "postgres") {
      await database.asAdmin((db) => db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`erp:idempotency:${actor.tenantId}:${actor.userId}:${payload.route}:${key}`}, 0))`));
    }
    const [existing] = await database.asAdmin((db) => db.select().from(idempotencyRequests).where(match).limit(1));
    if (existing) {
      if (existing.requestHash !== hash) throw new AppError("idempotency_conflict", "Esa llave ya se usó con otros datos.", 409);
      return existing.response as T;
    }
    await database.asAdmin((db) => db.insert(idempotencyRequests).values({
      tenantId: actor.tenantId, userId: actor.userId, operation: payload.route, key, requestHash: hash,
    }));
    const response = await fn();
    await database.asAdmin((db) => db.update(idempotencyRequests).set({
      status: "completed", response: toJson(response), completedAt: new Date(),
    }).where(match));
    return response;
  });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  });
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

export interface StockTarget {
  productId?: string | null;
  filamentId?: string | null;
}

function stockIdentity(item: StockTarget): { productId: string | null; filamentId: string | null } {
  if (item.filamentId) return { productId: null, filamentId: item.filamentId };
  if (item.productId) return { productId: item.productId, filamentId: null };
  throw new AppError("line_target", "La existencia necesita un producto o un filamento.");
}

async function loadBalance(db: Db, item: StockTarget, locationId: string) {
  const identity = stockIdentity(item);
  const match = identity.filamentId
    ? eq(stockBalances.filamentId, identity.filamentId)
    : eq(stockBalances.productId, identity.productId as string);
  const [balance] = await db
    .select()
    .from(stockBalances)
    .where(and(match, eq(stockBalances.locationId, locationId)))
    .limit(1);
  return balance ?? null;
}

async function saveBalance(
  db: Db,
  tenant: TenantActor,
  item: StockTarget,
  locationId: string,
  balance: { id: string } | null,
  values: Record<string, unknown>,
) {
  if (balance) {
    await db.update(stockBalances).set({ ...values, updatedAt: new Date() }).where(eq(stockBalances.id, balance.id));
    return;
  }
  const identity = stockIdentity(item);
  await db.insert(stockBalances).values({
    tenantId: tenant.tenantId,
    productId: identity.productId,
    filamentId: identity.filamentId,
    locationId,
    onHand: "0",
    allocated: "0",
    createdBy: tenant.userId,
    ...values,
  });
}

/** Valor en centavos de `quantity` (unidad de almacén) al costo vigente. El filamento se costea por gramo. */
export async function stockValueMinor(db: Db, item: StockTarget, quantity: bigint): Promise<bigint> {
  const identity = stockIdentity(item);
  if (identity.filamentId) {
    const [filament] = await db
      .select({ costMinor: filaments.costMinor })
      .from(filaments)
      .where(eq(filaments.id, identity.filamentId))
      .limit(1);
    if (!filament) return 0n;
    const unit = stockUnitCostMinor(filament.costMinor === null ? null : BigInt(filament.costMinor), "1000");
    return extendCostMinor(quantity, unit);
  }
  const [product] = await db
    .select({ costMinor: products.costMinor, uomFactor: products.uomFactor })
    .from(products)
    .where(eq(products.id, identity.productId as string))
    .limit(1);
  if (!product) return 0n;
  const unit = stockUnitCostMinor(product.costMinor === null ? null : BigInt(product.costMinor), String(product.uomFactor));
  return extendCostMinor(quantity, unit);
}

export interface StockPosting extends StockTarget {
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
  const identity = stockIdentity(input);
  const balance = await loadBalance(db, identity, input.locationId);
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
  await saveBalance(db, tenant, identity, input.locationId, balance, {
    onHand: formatQty(next),
    allocated: formatQty(maxQty(0n, allocated - (input.releaseAllocated ?? 0n))),
    ...(input.reorderPoint !== undefined ? { reorderPoint: formatQty(input.reorderPoint) } : {}),
    ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
  });
  if (input.delta === 0n) return;
  const value = input.valueMinor ?? (await stockValueMinor(db, identity, input.delta < 0n ? -input.delta : input.delta));
  await db.insert(stockLedgers).values({
    tenantId: tenant.tenantId,
    productId: identity.productId,
    filamentId: identity.filamentId,
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
  input: StockTarget & { locationId: string; quantity: bigint; reason: string; reference: { type: string; id: string } },
): Promise<void> {
  if (input.quantity === 0n) return;
  const identity = stockIdentity(input);
  const balance = await loadBalance(db, identity, input.locationId);
  const allocated = balance ? qtyFromDb(balance.allocated) : 0n;
  await saveBalance(db, tenant, identity, input.locationId, balance, {
    allocated: formatQty(maxQty(0n, allocated + input.quantity)),
  });
  await db.insert(stockLedgers).values({
    tenantId: tenant.tenantId,
    productId: identity.productId,
    filamentId: identity.filamentId,
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

export async function availableAt(db: Db, item: StockTarget | string, locationId: string): Promise<bigint> {
  const balance = await loadBalance(db, typeof item === "string" ? { productId: item } : item, locationId);
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

/** Abre o acumula un lote. El número es único por tenant; no se reusa entre productos. */
export async function ensureLot(
  db: Db,
  tenant: TenantActor,
  item: StockTarget,
  lotNumber: string,
  receivedQty: bigint,
  extra: { source?: "manual" | "purchase"; vendorLot?: string | null; vendorId?: string; purchaseOrderId?: string; receiptId?: string } = {},
): Promise<string> {
  const filamentId = item.filamentId ?? null;
  const productId = filamentId ? null : item.productId ?? null;
  const [existing] = await db.select().from(materialLots).where(eq(materialLots.lotNumber, lotNumber)).limit(1);
  if (existing) {
    if ((existing.filamentId ?? null) !== filamentId || (existing.productId ?? null) !== productId) {
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
      filamentId,
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
