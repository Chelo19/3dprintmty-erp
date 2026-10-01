import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
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
  expensePayments,
  expenses,
  filaments,
  locations,
  materialLots,
  products,
  purchaseOrderLines,
  purchaseOrders,
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
  minorToMajor,
  one,
  postStock,
  unwrap,
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

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const expenseSchema = z.object({
  kind: z.enum(["product", "filament", "service", "other"]),
  itemId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(180).optional(),
  quantity: z.string().default("1"),
  amount: z.string(),
  occurredOn: daySchema,
  paid: z.boolean().optional(),
  paidAmount: z.string().default("0"),
  paidOn: daySchema.optional(),
  note: z.string().trim().max(240).optional(),
});

const expensePaymentSchema = z.object({
  amount: z.string(),
  paidOn: daySchema,
  note: z.string().trim().max(240).optional(),
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

  @Get("expenses")
  async listExpenses(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const seeMoney = canReadSalePrice(tenant.role);
    const data = await this.database.asUser(tenant, async (db) => {
      const rows = await db.select().from(expenses).orderBy(desc(expenses.occurredOn), desc(expenses.createdAt));
      const payments = await paymentsByExpense(db, rows.map((row: ExpenseRow) => row.id));
      return rows.map((row: ExpenseRow) => presentExpense(row, payments.get(row.id) ?? [], seeMoney));
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
      return { ...presentExpense(expense, payments.get(expense.id) ?? [], seeMoney), payments: presentPayments(payments.get(expense.id) ?? [], seeMoney) };
    });
  }

  @Post("expenses")
  async createExpense(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = expenseSchema.parse(body);
    const quantity = parseQty(input.quantity);
    if (quantity <= 0n) throw new AppError("invalid_quantity", "La cantidad debe ser mayor a cero.");
    const amount = Money.fromMajor(input.amount).minor;
    if (amount < 0n) throw new AppError("invalid_money", "El importe no puede ser negativo.");
    const paid = input.paid === undefined ? Money.fromMajor(input.paidAmount).minor : input.paid ? amount : 0n;
    if (paid < 0n) throw new AppError("invalid_money", "La cantidad pagada no puede ser negativa.");
    if (paid > amount) throw new AppError("payment_exceeds_expense", "La cantidad pagada no puede ser mayor que el importe.");
    if (input.paid && !input.paidOn) input.paidOn = input.occurredOn;
    if (paid > 0n && !input.paidOn) throw new AppError("paid_on_required", "Indica la fecha del pago.");
    if ((input.kind === "product" || input.kind === "filament") && !input.itemId) {
      throw new AppError("item_required", "Elige el artículo del gasto.");
    }
    if ((input.kind === "service" || input.kind === "other") && !input.description) {
      throw new AppError("description_required", "Describe el gasto.");
    }

    const kind = input.kind;
    if (kind === "product" || kind === "filament") {
      const purchaseFolio = await allocateFolio(this.database, tenant.tenantId, "purchase_order", "OC");
      const draft = await this.database.asUser(tenant, async (db) => {
        const vendor = await directVendor(db, tenant);
        const description = await itemDescription(db, kind, input.itemId as string);
        const order = await createPurchaseOrder(db, tenant, {
          folio: `OC-${purchaseFolio}`,
          vendorId: vendor.id,
          notes: input.note ?? "Gasto directo",
          lines: [{
            productId: input.itemId as string,
            quantity,
            unitCostMinor: roundDiv(amount * 10_000n, quantity),
            description,
          }],
        });
        await db
          .update(purchaseOrders)
          .set({ status: "ordered", orderedAt: new Date(), updatedAt: new Date() })
          .where(eq(purchaseOrders.id, order.id));
        const loaded = await loadPurchaseOrder(db, order.id);
        const line = loaded.lines[0];
        if (!line) throw new AppError("invalid_quantity", "La compra no tiene líneas.");
        return { orderId: order.id, lineId: line.id as string, description };
      });
      await this.doReceive(tenant, draft.orderId, { lines: [{ lineId: draft.lineId, quantity: input.quantity }] });
      const expenseFolio = await allocateFolio(this.database, tenant.tenantId, "expense", "GAS");
      return this.database.asUser(tenant, (db) =>
        insertExpense(db, tenant, {
          folio: `GAS-${expenseFolio}`,
          kind,
          itemId: input.itemId as string,
          description: draft.description,
          quantity,
          amount,
          occurredOn: input.occurredOn,
          paid,
          paidOn: input.paidOn ?? null,
          purchaseOrderId: draft.orderId,
          note: input.note ?? null,
        }),
      );
    }

    const folio = await allocateFolio(this.database, tenant.tenantId, "expense", "GAS");
    return this.database.asUser(tenant, (db) =>
      insertExpense(db, tenant, {
        folio: `GAS-${folio}`,
        kind: input.kind,
        itemId: null,
        description: input.description as string,
        quantity,
        amount,
        occurredOn: input.occurredOn,
        paid,
        paidOn: input.paidOn ?? null,
        purchaseOrderId: null,
        note: input.note ?? null,
      }),
    );
  }

  @Post("expenses/:id/payments")
  async addExpensePayment(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, [...BUYERS]);
    const input = expensePaymentSchema.parse(body);
    const amount = Money.fromMajor(input.amount).minor;
    if (amount <= 0n) throw new AppError("invalid_money", "El pago debe ser mayor a cero.");
    return this.database.asUser(tenant, async (db) => {
      const expense = await one(db, expenses, expenses.id, id, "No encontramos ese gasto.");
      const payments = (await paymentsByExpense(db, [expense.id])).get(expense.id) ?? [];
      const paid = payments.reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
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
    return withIdempotency(this.database, tenant, idempotencyKey, { route: "receive", id, input }, () =>
      this.doReceive(tenant, id, input),
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
          purchaseOrderId: materialLots.purchaseOrderId,
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
          purchaseOrderId: materialLots.purchaseOrderId,
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

  private async doReceive(tenant: TenantActor, id: string, input: z.infer<typeof receiveSchema>) {
    await this.database.asUser(tenant, (db) => prepareReceipt(db, id, input));
    const receiptFolio = await allocateFolio(this.database, tenant.tenantId, "receipt", "REC");
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
      for (const [position, { entry, line, product, quantity, stockQty, value }] of prepared.entries()) {
        await updateAverageCost(db, product, stockQty, value);
        const lotId = await ensureLot(
          db,
          tenant,
          product.kind === "filament" ? { filamentId: product.id } : { productId: product.id },
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
          ...(product.kind === "filament" ? { filamentId: product.id } : { productId: product.id }),
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
          ...(product.kind === "filament" ? { filamentId: product.id, productId: null } : { productId: product.id, filamentId: null }),
          quantity: formatQty(quantity),
          stockQuantity: formatQty(stockQty),
          lotId,
          valueMinor: value,
        });
        await db
          .update(purchaseOrderLines)
          .set({ receivedQty: formatQty(qtyFromDb(line.receivedQty) + quantity) })
          .where(eq(purchaseOrderLines.id, line.id));
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
      });
      return {
        receipt: { id: receipt.id, folio: receipt.folio },
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
    const product = await purchasedItem(db, (line.filamentId ?? line.productId) as string);
    const stockQty = mulQty(quantity, parseQty(String(line.uomFactor)));
    const value = extendCostMinor(quantity, new Decimal(String(line.unitCostMinor)));
    lines.push({ entry, line, product, quantity, stockQty, value });
  }
  return { order, lines };
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
    return;
  }
  await db.update(products).set({ costMinor, updatedAt: new Date() }).where(eq(products.id, product.id));
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
    const product = await purchasedItem(db, line.productId);
    if (product.kind === "product" && product.productType === "service") {
      throw new AppError("invalid_product", "Los servicios no se compran a inventario.", 409);
    }
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
      notes: input.notes ?? null,
      createdBy: tenant.userId,
    })
    .returning();
  await db.insert(purchaseOrderLines).values(
    prepared.map((line) => ({
      tenantId: tenant.tenantId,
      purchaseOrderId: order.id,
      ...(line.product.kind === "filament"
        ? { filamentId: line.product.id, productId: null }
        : { productId: line.product.id, filamentId: null }),
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
  const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, order.id));
  const history = await db.select().from(receipts).where(eq(receipts.purchaseOrderId, order.id)).orderBy(desc(receipts.createdAt));
  const mapped = [];
  for (const line of lines as LineRow[]) {
    const item = await purchasedItem(db, (line.filamentId ?? line.productId) as string);
    mapped.push({
      id: line.id,
      productId: item.id,
      sku: item.sku,
      description: line.description,
      purchaseUom: line.purchaseUom,
      stockUom: item.stockUom,
      uomFactor: formatQty(qtyFromDb(line.uomFactor)),
      quantity: formatQty(qtyFromDb(line.quantity)),
      receivedQty: formatQty(qtyFromDb(line.receivedQty)),
      pendingQty: formatQty(qtyFromDb(line.quantity) - qtyFromDb(line.receivedQty)),
      unitCost: minorToMajor(line.unitCostMinor),
      lineTotal: minorToMajor(line.lineTotalMinor),
    });
  }
  return {
    ...mapPurchaseOrder(order),
    lines: mapped,
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
    paidOn: row.paidOn,
    amount: seeMoney ? Money.fromMinor(BigInt(row.amountMinor)).toMajor() : null,
    note: row.note,
  }));
}

function presentExpense(row: ExpenseRow, payments: ExpensePaymentRow[], seeMoney: boolean) {
  const amountMinor = BigInt(row.amountMinor);
  const paidMinor = payments.reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
  return {
    id: row.id,
    folio: row.folio,
    kind: row.kind,
    description: row.description,
    quantity: formatQty(qtyFromDb(row.quantity)),
    occurredOn: row.occurredOn,
    amount: seeMoney ? Money.fromMinor(amountMinor).toMajor() : null,
    paid: seeMoney ? Money.fromMinor(paidMinor).toMajor() : null,
    balance: seeMoney ? Money.fromMinor(amountMinor - paidMinor).toMajor() : null,
    paymentStatus: expensePaymentStatus(amountMinor, paidMinor),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

async function itemDescription(db: Db, kind: "product" | "filament", id: string) {
  if (kind === "filament") {
    const filament = await one(db, filaments, filaments.id, id, "No encontramos ese filamento.");
    return `${filament.sku} ${filament.name}`;
  }
  const product = await one(db, products, products.id, id, "No encontramos ese producto.");
  return `${product.sku} ${product.name}`;
}

async function insertExpense(
  db: Db,
  tenant: TenantActor,
  input: {
    folio: string;
    kind: "product" | "filament" | "service" | "other";
    itemId: string | null;
    description: string;
    quantity: bigint;
    amount: bigint;
    occurredOn: string;
    paid: bigint;
    paidOn: string | null;
    purchaseOrderId: string | null;
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
      purchaseOrderId: input.purchaseOrderId,
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

async function purchasedItem(db: Db, id: string) {
  const [filament] = await db.select().from(filaments).where(eq(filaments.id, id)).limit(1);
  if (filament) {
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

interface LineRow {
  id: string;
  purchaseOrderId: string;
  productId: string | null;
  filamentId: string | null;
  description: string;
  purchaseUom: string;
  uomFactor: string;
  quantity: string;
  receivedQty: string;
  unitCostMinor: bigint;
  lineTotalMinor: bigint;
}
