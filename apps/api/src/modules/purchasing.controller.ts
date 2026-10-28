import { reverseExpenseInventory } from "./expense-cancellation";
import { syncDependentProductCosts } from "./product-cost-sync";
import { loadCompanyProfile } from "./company-profile";
import { canPurchase } from "@3dprintmty/domain";
import { All, Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import {
  assertRfc,
  canReadSalePrice,
  extendCostMinor,
  formatQty,
  Money,
  mulQty,
  parseQty,
  qtyFromDb,
  roundDiv,
  stockUnitCostMinor,
} from "@3dprintmty/domain";
import { AppError } from "@3dprintmty/shared";
import Decimal from "decimal.js";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  expensePayments,
  expenseLines,
  expenses,
  filaments,
  locations,
  materialLots,
  products,
  receiptLines,
  receipts,
  stockBalances,
  vendors,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import { roundMinor } from "./manufacturing.shared";
import {
  allocateFolio,
  audit,
  defaultLocationId,
  ensureLot,
  one,
  postStock,
  withIdempotency,
  type Db,
} from "./support";

const BUYERS = ["owner", "admin", "warehouse"] as const;

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

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const purchaseLineSchema = z.object({
  kind: z.enum(["product", "filament", "service", "other"]),
  itemId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(180).optional(),
  quantity: z.string().default("1"),
  amount: z.string(),
  lotNumber: z.string().trim().max(60).optional(),
  vendorLot: z.string().trim().max(60).optional(),
});
const purchaseConditions = {
  occurredOn: daySchema,
  paid: z.boolean().optional(),
  paidAmount: z.string().default("0"),
  paidOn: daySchema.optional(),
  note: z.string().trim().max(240).optional(),
  vendorId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
};
const expenseSchema = z.union([
  z.object({ ...purchaseConditions, lines: z.array(purchaseLineSchema).min(1).max(100) }).strict(),
  purchaseLineSchema.extend(purchaseConditions).strict(),
]);

const cancelExpenseSchema = z.object({ reason: z.string().trim().min(3).max(240) }).strict();

const expensePaymentSchema = z.object({
  amount: z.string(),
  paidOn: daySchema,
  note: z.string().trim().max(240).optional(),
});

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

  @Get("expenses")
  async listExpenses(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const seeMoney = canReadSalePrice(tenant.role);
    const data = await this.database.asUser(tenant, async (db) => {
      const rows = await db.select({ expense: expenses, itemClass: products.itemClass, supplyMode: products.supplyMode })
        .from(expenses).leftJoin(products, eq(products.id, expenses.productId))
        .orderBy(desc(expenses.occurredOn), desc(expenses.createdAt));
      const payments = await paymentsByExpense(db, rows.map((row: { expense: ExpenseRow }) => row.expense.id));
      return rows.map((row: { expense: ExpenseRow; itemClass: string | null; supplyMode: string | null }) =>
        presentExpense(row.expense, payments.get(row.expense.id) ?? [], seeMoney, row));
    });
    return { data };
  }

  @Get("expenses/:id")
  async getExpense(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    const seeMoney = canReadSalePrice(tenant.role);
    return this.database.asUser(tenant, async (db) => {
      const expense = await one(db, expenses, expenses.id, id, "No encontramos ese gasto.");
      const payments = await paymentsByExpense(db, [expense.id]);
      const [classification] = expense.productId
        ? await db.select({ itemClass: products.itemClass, supplyMode: products.supplyMode }).from(products).where(eq(products.id, expense.productId)).limit(1)
        : [];
      return { ...presentExpense(expense, payments.get(expense.id) ?? [], seeMoney, classification), payments: presentPayments(payments.get(expense.id) ?? [], seeMoney), lines: await purchaseLines(db, expense.id, seeMoney) };
    });
  }

  @Post("expenses")
  async createExpense(@CurrentUser() actor: Actor, @Body() body: unknown, @Headers("Idempotency-Key") idempotencyKey?: string) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = expenseSchema.parse(body);
    const lines = ("lines" in input ? input.lines : [input]).map((line) => {
      const quantity = parseQty(line.quantity);
      if (quantity <= 0n) throw new AppError("invalid_quantity", "La cantidad debe ser mayor a cero.");
      const amount = Money.fromMajor(line.amount).minor;
      if (amount < 0n) throw new AppError("invalid_money", "El importe no puede ser negativo.");
      if ((line.kind === "product" || line.kind === "filament") && !line.itemId) throw new AppError("item_required", "Elige el artículo de cada partida.");
      if ((line.kind === "service" || line.kind === "other") && !line.description) throw new AppError("description_required", "Describe cada partida de gasto.");
      return { ...line, quantity, amount };
    });
    const amount = lines.reduce((total, line) => total + line.amount, 0n);
    const paid = input.paid === undefined ? Money.fromMajor(input.paidAmount).minor : input.paid ? amount : 0n;
    if (paid < 0n) throw new AppError("invalid_money", "La cantidad pagada no puede ser negativa.");
    if (paid > amount) throw new AppError("payment_exceeds_expense", "La cantidad pagada no puede ser mayor que el importe.");
    const paidOn = input.paid && !input.paidOn ? input.occurredOn : input.paidOn;
    if (paid > 0n && !paidOn) throw new AppError("paid_on_required", "Indica la fecha del pago.");

    return withIdempotency(this.database, tenant, idempotencyKey, { route: "expenses.create", input }, async () => {
      const folio = await allocateFolio(this.database, tenant.tenantId, "expense", "GAS");
      const hasInventory = lines.some((line) => line.kind === "product" || line.kind === "filament");
      const receiptFolio = hasInventory ? await allocateFolio(this.database, tenant.tenantId, "receipt", "REC") : null;
      return this.database.asUser(tenant, async (db) => {
        const resolved = [];
        for (const line of lines) {
          const product = line.kind === "product" || line.kind === "filament" ? await purchasedItem(db, line.itemId!) : null;
          if (product && product.kind !== line.kind) throw new AppError("invalid_product", "El artículo no corresponde al tipo de compra.");
          resolved.push({ ...line, product, description: product ? `${product.sku} ${product.name}` : line.description! });
        }
        const first = resolved[0]!;
        const expense = await insertExpense(db, tenant, {
          folio: `GAS-${folio}`, kind: resolved.length > 1 ? "mixed" : first.kind,
          itemId: resolved.length === 1 && first.product ? first.product.id : null,
          description: resolved.length === 1 ? first.description : `Compra de ${resolved.length} partidas: ${resolved.map((line) => line.description).join(" · ")}`.slice(0, 180),
          quantity: resolved.length === 1 ? first.quantity : parseQty("1"),
          amount, occurredOn: input.occurredOn, paid, paidOn: paidOn ?? null, note: input.note ?? null,
        });
        await db.insert(expenseLines).values(resolved.map((line, position) => ({
          tenantId: tenant.tenantId, expenseId: expense.id, position, kind: line.kind,
          productId: line.kind === "product" ? line.itemId : null, filamentId: line.kind === "filament" ? line.itemId : null,
          description: line.description, quantity: formatQty(line.quantity), amountMinor: line.amount,
          purchaseUom: line.product?.purchaseUom ?? "PZA", uomFactor: line.product?.uomFactor ?? "1", createdBy: tenant.userId,
        })));
        if (receiptFolio !== null) {
          const vendor = input.vendorId ? await one(db, vendors, vendors.id, input.vendorId, "No encontramos ese proveedor.") : await directVendor(db, tenant);
          if (!vendor.active) throw new AppError("vendor_inactive", "Ese proveedor está inactivo.", 409);
          const locationId = input.locationId ? (await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.")).id : await defaultLocationId(db);
          const [receipt] = await db.insert(receipts).values({ tenantId: tenant.tenantId, folio: `REC-${receiptFolio}`, expenseId: expense.id, vendorId: vendor.id, locationId, notes: input.note ?? null, createdBy: tenant.userId }).returning();
          for (const [position, line] of resolved.entries()) {
            if (!line.product) continue;
            // Volver a leer el costo tras cada recepción permite repetir un artículo en lotes distintos.
            const product = await purchasedItem(db, line.product.id);
            const stockQty = mulQty(line.quantity, parseQty(product.uomFactor));
            if (stockQty <= 0n) throw new AppError("invalid_quantity", "La cantidad recibida debe generar una entrada mayor a cero.");
            await updateAverageCost(db, product, stockQty, line.amount);
            const target = product.kind === "filament" ? { filamentId: product.id } : { productId: product.id };
            const lotId = await ensureLot(db, tenant, target, line.lotNumber || `${receipt.folio}-${position + 1}`, stockQty, { source: "purchase", vendorId: vendor.id, vendorLot: line.vendorLot ?? null, expenseId: expense.id, receiptId: receipt.id });
            await postStock(db, tenant, { ...target, locationId, kind: "receipt", delta: stockQty, valueMinor: line.amount, reason: `Recepción ${receipt.folio} de ${expense.folio}`, reference: { type: "receipt", id: receipt.id }, lotId });
            await db.insert(receiptLines).values({ tenantId: tenant.tenantId, receiptId: receipt.id, ...target, description: line.description, purchaseUom: product.purchaseUom, uomFactor: product.uomFactor, unitCostMinor: roundDiv(line.amount * 10_000n, line.quantity), quantity: formatQty(line.quantity), stockQuantity: formatQty(stockQty), lotId, valueMinor: line.amount });
          }
          await audit(db, tenant, "purchase.received", "receipt", receipt.id, { expenseId: expense.id, expenseFolio: expense.folio });
        }
        return { ...expense, lines: await purchaseLines(db, expense.id, true) };
      });
    }, { required: false });
  }

  @Post("expenses/:id/payments")
  async addExpensePayment(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = expensePaymentSchema.parse(body);
    const amount = Money.fromMajor(input.amount).minor;
    if (amount <= 0n) throw new AppError("invalid_money", "El pago debe ser mayor a cero.");
    return this.database.asUser(tenant, async (db) => {
      const expense = await one(db, expenses, expenses.id, id, "No encontramos ese gasto.");
      if (expense.canceledAt) throw new AppError("expense_canceled", "No puedes abonar a un gasto cancelado.", 409);
      const payments = (await paymentsByExpense(db, [expense.id])).get(expense.id) ?? [];
      const paid = payments.reduce((sum, payment) => sum + (payment.canceledAt ? 0n : BigInt(payment.amountMinor)), 0n);
      const due = BigInt(expense.amountMinor) - paid;
      if (due <= 0n) throw new AppError("expense_settled", "Este gasto ya está pagado.");
      if (amount > due) throw new AppError("payment_exceeds_expense", "El pago rebasa el saldo del gasto.");
      const [row] = await db
        .insert(expensePayments)
        .values({
          tenantId: tenant.tenantId,
          expenseId: expense.id,
          paidOn: input.paidOn,
          amountMinor: amount,
          note: input.note ?? null,
          createdBy: tenant.userId,
        })
        .returning();
      await audit(db, tenant, "expense.payment_recorded", "expense", expense.id, { amountMinor: amount.toString(), paidOn: input.paidOn });
      return {
        id: row.id,
        paidOn: row.paidOn,
        amount: Money.fromMinor(BigInt(row.amountMinor)).toMajor(),
        note: row.note,
      };
    });
  }

  @Post("expenses/:id/cancel")
  async cancelExpense(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown, @Headers("Idempotency-Key") key?: string) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = cancelExpenseSchema.parse(body);
    return withIdempotency(this.database, tenant, key, { route: `expenses.${id}.cancel`, input }, () =>
      this.database.asUser(tenant, async (db) => {
        const expense = await one(db, expenses, expenses.id, id, "No encontramos ese gasto.");
        if (!expense.canceledAt) {
          await reverseExpenseInventory(db, tenant, expense, input.reason);
          const cancellation = { canceledAt: new Date(), canceledBy: tenant.userId, cancellationReason: input.reason };
          await db.update(expensePayments).set(cancellation).where(eq(expensePayments.expenseId, id));
          await db.update(expenses).set(cancellation).where(eq(expenses.id, id));
          await audit(db, tenant, "expense.canceled", "expense", id, { reason: input.reason, paymentsCanceled: true });
        }
        const updated = await one(db, expenses, expenses.id, id, "No encontramos ese gasto.");
        const payments = (await paymentsByExpense(db, [id])).get(id) ?? [];
        return { ...presentExpense(updated, payments, true), payments: presentPayments(payments, true) };
      }),
    );
  }

  @Get("lots")
  async lots(@CurrentUser() actor: Actor, @Query("productId") productId?: string) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, async (db) => {
      const goods = await db
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
          expenseId: materialLots.expenseId,
        })
        .from(materialLots)
        .innerJoin(products, eq(products.id, materialLots.productId))
        .where(productId ? eq(materialLots.productId, productId) : undefined);
      const filamentsLots = await db
        .select({
          id: materialLots.id,
          lotNumber: materialLots.lotNumber,
          vendorLot: materialLots.vendorLot,
          source: materialLots.source,
          productId: materialLots.filamentId,
          sku: filaments.sku,
          name: filaments.name,
          receivedQty: materialLots.receivedQty,
          receivedAt: materialLots.receivedAt,
          expenseId: materialLots.expenseId,
        })
        .from(materialLots)
        .innerJoin(filaments, eq(filaments.id, materialLots.filamentId))
        .where(productId ? eq(materialLots.filamentId, productId) : undefined);
      return [...goods, ...filamentsLots].sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt));
    });
    return {
      data: rows.map((row: { receivedQty: string }) => ({ ...row, receivedQty: formatQty(qtyFromDb(row.receivedQty)) })),
    };
  }

}

/** Costo promedio ponderado por unidad de compra (lo que el catálogo guarda: MXN/kg, MXN/pieza). */
async function updateAverageCost(
  db: Db,
  product: { id: string; kind: "product" | "filament"; costMinor: bigint | string | null; uomFactor: string },
  receivedStockQty: bigint,
  receivedValueMinor: bigint,
) {
  const balances = await db
    .select({ onHand: stockBalances.onHand })
    .from(stockBalances)
    .where(product.kind === "filament" ? eq(stockBalances.filamentId, product.id) : eq(stockBalances.productId, product.id));
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
  const costMinor = roundMinor(perStock.mul(factor));
  if (product.kind === "filament") {
    await db.update(filaments).set({ costMinor, updatedAt: new Date() }).where(eq(filaments.id, product.id));
  } else {
    await db.update(products).set({ costMinor, updatedAt: new Date() }).where(eq(products.id, product.id));
  }
  await syncDependentProductCosts(db, product.id);
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

async function directVendor(db: Db, tenant: TenantActor) {
  const [existing] = await db.select().from(vendors).where(eq(vendors.name, "Gasto directo")).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(vendors)
    .values({
      tenantId: tenant.tenantId,
      name: "Gasto directo",
      paymentTerms: "contado",
      leadTimeDays: 0,
      notes: "Proveedor interno para gastos registrados directo.",
      createdBy: tenant.userId,
    })
    .returning();
  return created;
}

type ExpenseRow = typeof expenses.$inferSelect;
type ExpensePaymentRow = typeof expensePayments.$inferSelect;

function expensePaymentStatus(amount: bigint, paid: bigint) {
  if (amount <= 0n || paid >= amount) return "paid";
  if (paid <= 0n) return "pending";
  return "partial";
}

async function paymentsByExpense(db: Db, ids: string[]) {
  const grouped = new Map<string, ExpensePaymentRow[]>();
  if (ids.length === 0) return grouped;
  const rows = await db
    .select()
    .from(expensePayments)
    .where(inArray(expensePayments.expenseId, ids))
    .orderBy(expensePayments.paidOn, expensePayments.createdAt);
  for (const row of rows) {
    const list = grouped.get(row.expenseId) ?? [];
    list.push(row);
    grouped.set(row.expenseId, list);
  }
  return grouped;
}

function presentPayments(rows: ExpensePaymentRow[], seeMoney: boolean) {
  return rows.map((row) => ({
    id: row.id,
    canceledAt: row.canceledAt,
    paidOn: row.paidOn,
    amount: seeMoney ? Money.fromMinor(BigInt(row.amountMinor)).toMajor() : null,
    note: row.note,
  }));
}

function presentExpense(row: ExpenseRow, payments: ExpensePaymentRow[], seeMoney: boolean, classification?: { itemClass: string | null; supplyMode: string | null }) {
  const amountMinor = BigInt(row.amountMinor);
  const paidMinor = payments.reduce((sum, payment) => sum + (payment.canceledAt ? 0n : BigInt(payment.amountMinor)), 0n);
  return {
    id: row.id,
    folio: row.folio,
    kind: row.kind,
    itemClass: classification?.itemClass ?? null,
    supplyMode: classification?.supplyMode ?? null,
    description: row.description,
    quantity: formatQty(qtyFromDb(row.quantity)),
    occurredOn: row.occurredOn,
    amount: seeMoney ? Money.fromMinor(amountMinor).toMajor() : null,
    paid: seeMoney ? Money.fromMinor(paidMinor).toMajor() : null,
    balance: seeMoney ? Money.fromMinor(row.canceledAt ? 0n : amountMinor - paidMinor).toMajor() : null,
    canceledAt: row.canceledAt,
    canceledBy: row.canceledBy,
    cancellationReason: row.cancellationReason,
    paymentStatus: row.canceledAt ? "canceled" : expensePaymentStatus(amountMinor, paidMinor),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

async function purchaseLines(db: Db, expenseId: string, seeMoney: boolean) {
  const rows = await db.select({ line: expenseLines, itemClass: products.itemClass, supplyMode: products.supplyMode }).from(expenseLines)
    .leftJoin(products, eq(products.id, expenseLines.productId)).where(eq(expenseLines.expenseId, expenseId)).orderBy(asc(expenseLines.position));
  return rows.map(({ line, itemClass, supplyMode }: { line: typeof expenseLines.$inferSelect; itemClass: string | null; supplyMode: string | null }) => ({
    id: line.id, kind: line.kind, itemId: line.productId ?? line.filamentId, itemClass, supplyMode,
    description: line.description, quantity: formatQty(qtyFromDb(line.quantity)), purchaseUom: line.purchaseUom,
    amount: seeMoney ? Money.fromMinor(BigInt(line.amountMinor)).toMajor() : null,
  }));
}

async function insertExpense(
  db: Db,
  tenant: TenantActor,
  input: {
    folio: string;
    kind: "product" | "filament" | "service" | "other" | "mixed";
    itemId: string | null;
    description: string;
    quantity: bigint;
    amount: bigint;
    occurredOn: string;
    paid: bigint;
    paidOn: string | null;
    note: string | null;
  },
) {
  const [row] = await db
    .insert(expenses)
    .values({
      tenantId: tenant.tenantId,
      folio: input.folio,
      kind: input.kind,
      productId: input.kind === "product" ? input.itemId : null,
      filamentId: input.kind === "filament" ? input.itemId : null,
      serviceId: null,
      description: input.description,
      quantity: formatQty(input.quantity),
      amountMinor: input.amount,
      occurredOn: input.occurredOn,
      note: input.note,
      createdBy: tenant.userId,
    })
    .returning();
  const payments: ExpensePaymentRow[] = [];
  if (input.paid > 0n) {
    const [payment] = await db
      .insert(expensePayments)
      .values({
        tenantId: tenant.tenantId,
        expenseId: row.id,
        paidOn: input.paidOn as string,
        amountMinor: input.paid,
        createdBy: tenant.userId,
      })
      .returning();
    if (payment) payments.push(payment);
  }
  await audit(db, tenant, "expense.created", "expense", row.id, { folio: row.folio, kind: row.kind });
  return { ...presentExpense(row, payments, true), payments: presentPayments(payments, true) };
}

async function purchasedItem(db: Db, id: string, requirePurchasable = true) {
  const [filament] = await db.select().from(filaments).where(eq(filaments.id, id)).limit(1);
  if (filament) {
    if (filament.status !== "active") throw new AppError("item_inactive", "Ese filamento está inactivo.", 409);
    return {
      id: filament.id,
      kind: "filament" as const,
      sku: filament.sku as string,
      name: filament.name as string,
      productType: "filament",
      stockUom: "G",
      purchaseUom: "KG",
      uomFactor: "1000",
      costMinor: filament.costMinor as bigint | null,
    };
  }
  const product = await one(db, products, products.id, id, "No encontramos ese producto.");
  if (product.status !== "active") throw new AppError("item_inactive", "Ese producto está inactivo.", 409);
  if (requirePurchasable && !canPurchase(product)) throw new AppError("not_purchasable", "No se pueden comprar productos con fabricación habilitada. Compra un producto de reventa o un insumo con compra habilitada.", 409);
  return {
    id: product.id as string,
    kind: "product" as const,
    sku: product.sku as string,
    name: product.name as string,
    productType: product.productType as string,
    stockUom: product.stockUom as string,
    purchaseUom: product.purchaseUom as string,
    uomFactor: String(product.uomFactor),
    costMinor: product.costMinor as bigint | null,
  };
}

/** Routes remain closed explicitly while OC are outside the current product scope. */
@Controller("purchase-orders")
export class DisabledPurchaseOrdersController {
  @All(["", ":id", ":id/:action"])
  disabled() {
    throw new AppError("module_disabled", "Las órdenes de compra quedan fuera del alcance actual.", 503);
  }
}
