import { Body, Controller, Get, Header, Headers, Param, Post, StreamableFile } from "@nestjs/common";
import {
  assertMxState,
  assertPostalCode,
  assertRfc,
  assertTaxRegime,
  canReadSalePrice,
  formatQty as fromQty,
  Money,
  mulQty,
  normalizeMxPhone,
  parseQty as toQty,
  qtyFromDb,
  roundDiv,
  transitionQuote,
  type QuoteState,
  type TenantRole,
} from "@3dprintmty/domain";
import { manualPaymentPort } from "@3dprintmty/payments";
import { AppError } from "@3dprintmty/shared";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  companyProfiles,
  customerAddresses,
  customers,
  locations,
  paymentMethodSettings,
  payments,
  products,
  quoteLines,
  quotePrints,
  quotes,
  salesOrderLines,
  salesOrders,
  stockBalances,
  stockLedgers,
} from "../db/schema";
import { assertRole, CurrentUser, requireTenant, type Actor, type TenantActor } from "../http/actor";
import {
  dueMinor,
  mapOrder,
  mapPayment,
  orderEvent,
  priceLines,
  refreshPaymentStatus,
  type PaymentRow,
} from "./orders.shared";
import { renderQuotePdf } from "./quote-pdf";
import { allocateFolio, one, postStock, withIdempotency, type Db } from "./support";

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(160),
  neighborhood: z.string().trim().min(1).max(80),
  postalCode: z.string(),
  state: z.string(),
});

const customerSchema = z.object({
  kind: z.enum(["b2b", "b2c"]),
  legalName: z.string().trim().min(1).max(160),
  rfc: z.string().optional(),
  phone: z.string().optional(),
  paymentTerms: z.enum(["pue", "net_15", "net_30"]).default("pue"),
  creditLimit: z.string().default("0.00"),
  taxRegime: z.string().optional(),
  cfdiUse: z.string().trim().regex(/^[A-Z]\d{2}$/).default("G03"),
  billingEmail: z.string().trim().email().optional(),
  fiscal: addressSchema,
  shipping: addressSchema.optional(),
});

const lineSchema = z
  .object({
    productId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    description: z.string().trim().min(1).max(180),
    quantity: z.string(),
    unitPrice: z.string(),
    discount: z.string().optional(),
    terms: z.string().trim().max(1000).optional(),
  })
  .refine((line) => Boolean(line.productId) !== Boolean(line.serviceId), {
    message: "Cada partida es un producto o un servicio.",
  });

const quoteSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("prints"),
    customerId: z.string().uuid(),
    serviceTerms: z.string().trim().max(2000).optional(),
    prints: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          quantity: z.string(),
          services: z.array(lineSchema).max(40).default([]),
          filaments: z.array(lineSchema).max(40).default([]),
        }),
      )
      .min(1)
      .max(30),
  }),
  z.object({
    mode: z.literal("products"),
    customerId: z.string().uuid(),
    serviceTerms: z.string().trim().max(2000).optional(),
    lines: z.array(lineSchema).min(1).max(100),
  }),
]);

const movementSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  kind: z.enum(["receipt", "issue", "adjustment"]),
  quantity: z.string(),
  reason: z.string().trim().min(3).max(180),
  reorderPoint: z.string().optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
});

const paymentSchema = z.object({
  orderId: z.string().uuid(),
  method: z.enum(["efectivo", "spei", "tarjeta", "cod"]),
  kind: z.enum(["payment", "refund"]).default("payment"),
  amount: z.string(),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(180).optional(),
});

@Controller()
export class OperationsController {
  private get database() {
    return services().database;
  }

  @Get("inventory/balances")
  async balances(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: stockBalances.id,
          productId: stockBalances.productId,
          sku: products.sku,
          name: products.name,
          stockUom: products.stockUom,
          locationId: stockBalances.locationId,
          locationName: locations.name,
          onHand: stockBalances.onHand,
          allocated: stockBalances.allocated,
          reorderPoint: stockBalances.reorderPoint,
          leadTimeDays: stockBalances.leadTimeDays,
        })
        .from(stockBalances)
        .innerJoin(products, eq(products.id, stockBalances.productId))
        .innerJoin(locations, eq(locations.id, stockBalances.locationId))
        .orderBy(products.sku),
    );
    return {
      data: rows.map((row: BalanceRow) => {
        const onHand = fromQty(toQty(String(row.onHand)));
        const allocated = fromQty(toQty(String(row.allocated)));
        const available = fromQty(toQty(String(row.onHand)) - toQty(String(row.allocated)));
        const reorder = toQty(String(row.reorderPoint));
        return {
          id: row.id,
          productId: row.productId,
          sku: row.sku,
          name: row.name,
          stockUom: row.stockUom,
          locationId: row.locationId,
          locationName: row.locationName,
          onHand,
          allocated,
          available,
          reorderPoint: fromQty(reorder),
          leadTimeDays: row.leadTimeDays,
          lowStock: reorder > 0n && toQty(String(row.onHand)) <= reorder,
        };
      }),
    };
  }

  @Get("inventory/ledger")
  async ledger(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: stockLedgers.id,
          kind: stockLedgers.kind,
          quantity: stockLedgers.quantity,
          reason: stockLedgers.reason,
          createdAt: stockLedgers.createdAt,
          sku: products.sku,
          locationName: locations.name,
        })
        .from(stockLedgers)
        .innerJoin(products, eq(products.id, stockLedgers.productId))
        .innerJoin(locations, eq(locations.id, stockLedgers.locationId))
        .orderBy(desc(stockLedgers.createdAt))
        .limit(100),
    );
    return {
      data: rows.map((row: { quantity: string }) => ({
        ...row,
        quantity: fromQty(toQty(String(row.quantity))),
      })),
    };
  }

  @Post("inventory/movements")
  async move(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "warehouse"]);
    const input = movementSchema.parse(body);
    const delta = movementDelta(input.kind, input.quantity);
    const reorder = input.reorderPoint ? toQty(input.reorderPoint) : undefined;
    if (reorder !== undefined && reorder < 0n) {
      throw new AppError("invalid_quantity", "El punto de reorden no puede ser negativo.");
    }
    await this.database.asUser(tenant, async (db) => {
      const product = await one(db, products, products.id, input.productId, "No encontramos ese producto.");
      const location = await one(db, locations, locations.id, input.locationId, "No encontramos esa sucursal.");
      await postStock(db, tenant, {
        productId: product.id,
        locationId: location.id,
        kind: input.kind,
        delta,
        reason: input.reason,
        reorderPoint: reorder,
        leadTimeDays: input.leadTimeDays,
      });
    });
    return { ok: true };
  }

  @Get("customers")
  async listCustomers(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db.select().from(customers).orderBy(desc(customers.createdAt)),
    );
    return { data: rows.map((row: CustomerRow) => mapCustomer(row, tenant.role)) };
  }

  @Post("customers")
  async createCustomer(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const input = customerSchema.parse(body);
    const rfc = input.kind === "b2b" || input.rfc?.trim() ? assertRfc(input.rfc ?? "") : null;
    const phone = input.phone?.trim() ? normalizeMxPhone(input.phone) : null;
    const fiscal = cleanAddress(input.fiscal);
    const shipping = input.shipping ? cleanAddress(input.shipping) : null;
    const credit = Money.fromMajor(input.creditLimit).minor;
    if (credit < 0n) throw new AppError("invalid_money", "El límite de crédito no puede ser negativo.");
    const [created] = await this.database.asUser(tenant, async (db) => {
      const [customer] = await db
        .insert(customers)
        .values({
          tenantId: tenant.tenantId,
          kind: input.kind,
          legalName: input.legalName,
          rfc,
          phone,
          paymentTerms: input.paymentTerms,
          creditLimitMinor: credit,
          taxRegime: input.taxRegime?.trim() ? assertTaxRegime(input.taxRegime.trim()) : null,
          cfdiUse: input.cfdiUse,
          billingEmail: input.billingEmail ?? null,
          createdBy: tenant.userId,
        })
        .returning();
      await db.insert(customerAddresses).values({
        tenantId: tenant.tenantId,
        customerId: customer.id,
        kind: "fiscal",
        createdBy: tenant.userId,
        ...fiscal,
      });
      if (shipping) {
        await db.insert(customerAddresses).values({
          tenantId: tenant.tenantId,
          customerId: customer.id,
          kind: "shipping",
          createdBy: tenant.userId,
          ...shipping,
        });
      }
      return [customer];
    });
    return mapCustomer(created, tenant.role);
  }

  @Get("quotes")
  async listQuotes(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) => db.select().from(quotes).orderBy(desc(quotes.createdAt)));
    return { data: rows.map((row: QuoteRow) => mapQuote(row, tenant.role)) };
  }

  @Get("quotes/:id")
  async getQuote(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = requireTenant(actor);
    return this.database.asUser(tenant, async (db) => loadQuote(db, id, tenant.role));
  }

  @Get("quotes/:id/pdf")
  @Header("Content-Type", "application/pdf")
  async quotePdf(@CurrentUser() actor: Actor, @Param("id") id: string): Promise<StreamableFile> {
    const tenant = requireTenant(actor);
    const file = await this.database.asUser(tenant, async (db) => {
      const quote = await loadQuote(db, id, tenant.role);
      const [company] = await db.select().from(companyProfiles).limit(1);
      const bytes = renderQuotePdf({
        folio: quote.folio,
        issuedAt: new Date(quote.createdAt).toLocaleDateString("es-MX"),
        customerName: quote.customerName,
        customerRfc: quote.customerRfc,
        paymentTerms: paymentTermsLabel(quote.paymentTerms),
        validUntil: new Date(quote.validUntil).toLocaleDateString("es-MX"),
        mode: quote.mode,
        serviceTerms: quote.serviceTerms,
        subtotal: quote.subtotal,
        discount: quote.discount,
        vat: quote.vat,
        vatRate: quote.vatRate,
        total: quote.total,
        currency: quote.currency,
        issuer: quote.issuer?.tradeName || quote.issuer?.legalName || company?.tradeName || company?.legalName || "Taller",
        issuerRfc: quote.issuer?.rfc ?? company?.rfc ?? "—",
        issuerRegime: quote.issuer?.taxRegime ?? company?.taxRegime ?? "—",
        issuerPostalCode: quote.issuer?.postalCode ?? company?.fiscalPostalCode ?? "—",
        prints: quote.prints,
        lines: quote.lines,
      });
      return { filename: `${quote.folio}.pdf`, bytes };
    });
    return new StreamableFile(Buffer.from(file.bytes), {
      type: "application/pdf",
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Post("quotes")
  async createQuote(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const input = quoteSchema.parse(body);
    const folio = await allocateFolio(this.database, tenant.tenantId, "quote", "COT");
    const quote = await this.database.asUser(tenant, async (db) => {
      const customer = await one(db, customers, customers.id, input.customerId, "No encontramos ese cliente.");
      if (customer.status !== "active") {
        throw new AppError("customer_inactive", "Ese cliente no puede recibir cotizaciones.", 409);
      }
      const draft = draftQuoteLines(input);
      const priced = await priceLines(db, draft.lines, undefined, "0");
      assertQuoteMode(input.mode, priced.stored.map((line) => line.lineKind));
      const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const [created] = await db
        .insert(quotes)
        .values({
          tenantId: tenant.tenantId,
          folio: `COT-${folio}`,
          customerId: customer.id,
          customerName: customer.legalName,
          customerRfc: customer.rfc,
          mode: input.mode,
          validUntil,
          subtotalMinor: Money.fromMajor(priced.subtotal).minor,
          discountMinor: Money.fromMajor(priced.discount).minor,
          vatMinor: Money.fromMajor(priced.tax).minor,
          totalMinor: Money.fromMajor(priced.total).minor,
          serviceTerms: input.serviceTerms || null,
          createdBy: tenant.userId,
        })
        .returning();
      const printIds: Array<string | null> = [];
      if (input.mode === "prints") {
        for (const [index, print] of draft.prints.entries()) {
          const [row] = await db
            .insert(quotePrints)
            .values({
              tenantId: tenant.tenantId,
              quoteId: created.id,
              position: index,
              name: print.name,
              quantity: fromQty(toQty(print.quantity)),
            })
            .returning();
          print.lineCount && printIds.push(...Array(print.lineCount).fill(row.id));
        }
      }
      await db.insert(quoteLines).values(
        priced.stored.map((line, position) => ({
          ...line,
          position,
          printId: printIds[position] ?? null,
          description: draft.labels[position] ? `${draft.labels[position]} · ${line.description}` : line.description,
          tenantId: tenant.tenantId,
          quoteId: created.id,
        })),
      );
      return created;
    });
    return mapQuote(quote, tenant.role);
  }

  @Post("quotes/:id/transition")
  async transitionQuoteStatus(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const input = z.object({ to: z.enum(["sent", "accepted", "expired", "void"]) }).parse(body);
    const updated = await this.database.asUser(tenant, async (db) => {
      const quote = await one(db, quotes, quotes.id, id, "No encontramos esa cotización.");
      if (input.to === "accepted" && new Date(quote.validUntil).getTime() < Date.now()) {
        await db.update(quotes).set({ status: "expired" }).where(eq(quotes.id, quote.id));
        throw new AppError("quote_expired", "La cotización ya venció.", 409);
      }
      const next = transitionQuote(quote.status as QuoteState, input.to);
      if (!next.ok) throw next.error;
      const [row] = await db.update(quotes).set({ status: next.value }).where(eq(quotes.id, quote.id)).returning();
      return row;
    });
    return mapQuote(updated, tenant.role);
  }

  @Post("quotes/:id/convert")
  async convertQuote(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const folio = await allocateFolio(this.database, tenant.tenantId, "order", "PED");
    const order = await this.database.asUser(tenant, async (db) => {
      const quote = await one(db, quotes, quotes.id, id, "No encontramos esa cotización.");
      const next = transitionQuote(quote.status as QuoteState, "converted");
      if (!next.ok) throw next.error;
      const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)).orderBy(asc(quoteLines.position));
      const [created] = await db
        .insert(salesOrders)
        .values({
          tenantId: tenant.tenantId,
          folio: `PED-${folio}`,
          quoteId: quote.id,
          customerId: quote.customerId,
          customerName: quote.customerName,
          customerRfc: quote.customerRfc,
          status: "pending",
          subtotalMinor: quote.subtotalMinor,
          discountMinor: quote.discountMinor,
          shippingMinor: 0n,
          vatMinor: quote.vatMinor,
          totalMinor: quote.totalMinor,
          serviceTerms: quote.serviceTerms,
          createdBy: tenant.userId,
        })
        .returning();
      if (lines.length) {
        await db.insert(salesOrderLines).values(
          lines.map((line: StoredLine, position: number) => ({
            tenantId: tenant.tenantId,
            salesOrderId: created.id,
            position,
            productId: line.productId,
            serviceId: line.serviceId,
            lineKind: line.lineKind,
            terms: line.terms,
            description: line.description,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor,
            netMinor: line.netMinor,
            vatMinor: line.vatMinor,
            totalMinor: line.totalMinor,
          })),
        );
      }
      await db.update(quotes).set({ status: "converted" }).where(eq(quotes.id, quote.id));
      await orderEvent(db, tenant, created.id, "created", { to: created.status, note: `Desde ${quote.folio}` });
      return created;
    });
    return mapOrder(order, tenant.role);
  }

  @Get("payments")
  async listPayments(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const rows = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: payments.id,
          orderId: payments.salesOrderId,
          folio: salesOrders.folio,
          method: payments.method,
          kind: payments.kind,
          status: payments.status,
          amountMinor: payments.amountMinor,
          reference: payments.reference,
          note: payments.note,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .innerJoin(salesOrders, eq(salesOrders.id, payments.salesOrderId))
        .orderBy(desc(payments.createdAt))
        .limit(100),
    );
    return { data: rows.map((row: PaymentRow) => mapPayment(row, tenant.role)) };
  }

  @Post("payments")
  async createPayment(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const input = paymentSchema.parse(body);
    return withIdempotency(this.database, tenant.userId, idempotencyKey, { route: "payments", input }, () =>
      this.recordPayment(tenant, input),
    );
  }

  private async recordPayment(tenant: TenantActor, input: z.infer<typeof paymentSchema>) {
    const amount = Money.fromMajor(input.amount);
    if (input.kind === "payment") {
      manualPaymentPort.recordManual?.({
        method: input.method === "tarjeta" ? "efectivo" : input.method,
        amount,
        reference: input.reference,
      });
    } else if (amount.minor <= 0n) {
      throw new AppError("invalid_money", "El reembolso debe ser mayor a cero.");
    }
    const recorded = await this.database.asUser(tenant, async (db) => {
      const order = await one(db, salesOrders, salesOrders.id, input.orderId, "No encontramos ese pedido.");
      if (order.status === "cancelled" || order.status === "draft") {
        throw new AppError("order_not_billable", "Confirma el pedido antes de registrar un cobro.", 409);
      }
      const [setting] = await db
        .select()
        .from(paymentMethodSettings)
        .where(eq(paymentMethodSettings.method, input.method))
        .limit(1);
      if (!setting?.enabled) {
        throw new AppError("payment_method_disabled", "Ese método de cobro no está activo en el taller.", 409);
      }
      const ledger = await db.select().from(payments).where(eq(payments.salesOrderId, order.id));
      const due = dueMinor(order.totalMinor, ledger);
      const paid = order.totalMinor - due;
      if (input.kind === "payment" && input.method !== "cod" && amount.minor > due) {
        throw new AppError("overpayment", "El cobro supera el saldo.", 409);
      }
      if (input.kind === "refund" && amount.minor > paid) {
        throw new AppError("overpayment", "El reembolso supera lo cobrado.", 409);
      }
      const status = input.method === "cod" && input.kind === "payment" ? "pending" : "completed";
      const [created] = await db
        .insert(payments)
        .values({
          tenantId: tenant.tenantId,
          salesOrderId: order.id,
          method: input.method,
          kind: input.kind,
          status,
          amountMinor: amount.minor,
          reference: input.reference || null,
          note: input.note || null,
          createdBy: tenant.userId,
        })
        .returning();
      await refreshPaymentStatus(db, order.id, order.totalMinor);
      return created;
    });
    return mapPayment(
      {
        ...recorded,
        orderId: recorded.salesOrderId,
        folio: "",
      },
      tenant.role,
    );
  }

  @Post("payments/:id/complete")
  async completePayment(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, ["owner", "admin", "sales"]);
    const updated = await this.database.asUser(tenant, async (db) => {
      const payment = await one(db, payments, payments.id, id, "No encontramos ese cobro.");
      if (payment.status !== "pending") {
        throw new AppError("invalid_transition", "Ese cobro ya no está pendiente.", 409);
      }
      const [row] = await db.update(payments).set({ status: "completed" }).where(eq(payments.id, payment.id)).returning();
      const order = await one(db, salesOrders, salesOrders.id, payment.salesOrderId, "No encontramos ese pedido.");
      await refreshPaymentStatus(db, order.id, order.totalMinor);
      return row;
    });
    return mapPayment({ ...updated, orderId: updated.salesOrderId, folio: "" }, tenant.role);
  }
}

async function loadQuote(db: Db, id: string, role: TenantRole) {
  const quote = await one(db, quotes, quotes.id, id, "No encontramos esa cotización.");
  const customer = await one(db, customers, customers.id, quote.customerId, "No encontramos ese cliente.");
  const [company] = await db.select().from(companyProfiles).limit(1);
  const prints = await db.select().from(quotePrints).where(eq(quotePrints.quoteId, quote.id)).orderBy(asc(quotePrints.position));
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)).orderBy(asc(quoteLines.position));
  const mapped = lines.map((line: StoredLine) => mapLine(line, role));
  return {
    ...mapQuote(quote, role),
    paymentTerms: customer.paymentTerms,
    vatRate: company ? String(company.defaultVatRate) : "0.1600",
    issuer: company
      ? {
          legalName: company.legalName,
          tradeName: company.tradeName,
          rfc: company.rfc,
          taxRegime: company.taxRegime,
          postalCode: company.fiscalPostalCode,
        }
      : null,
    prints: prints.map((print: { id: string; name: string; quantity: string }) => {
      const quantity = fromQty(qtyFromDb(print.quantity));
      const raw = lines.filter((line: StoredLine) => line.printId === print.id);
      return {
        id: print.id,
        name: print.name,
        quantity,
        unitTotal: perPiece(raw, "netMinor", quantity, role),
        subtotal: sumMinor(raw, "netMinor", role),
        discount: sumMinor(raw, "discountMinor", role),
        vat: sumMinor(raw, "vatMinor", role),
        total: sumMinor(raw, "totalMinor", role),
        lines: mapped.filter((line: { printId: string | null }) => line.printId === print.id),
      };
    }),
    lines: mapped.filter((line: { printId: string | null }) => !line.printId),
  };
}

function sumMinor(lines: StoredLine[], field: "netMinor" | "discountMinor" | "vatMinor" | "totalMinor", role: TenantRole) {
  return money(lines.reduce((sum, line) => sum + BigInt(line[field]), 0n), role);
}

function perPiece(lines: StoredLine[], field: "netMinor", quantity: string, role: TenantRole) {
  const pieces = qtyFromDb(quantity);
  if (pieces <= 0n) return money(0n, role);
  const total = lines.reduce((sum, line) => sum + BigInt(line[field]), 0n);
  return money(roundDiv(total * 10_000n, pieces), role);
}

function paymentTermsLabel(value: string): string {
  if (value === "net_15") return "Crédito 15 días";
  if (value === "net_30") return "Crédito 30 días";
  return "Contado (PUE)";
}

function draftQuoteLines(input: z.infer<typeof quoteSchema>) {
  if (input.mode === "products") {
    return { lines: input.lines, labels: input.lines.map(() => null as string | null), prints: [] as Array<{ name: string; quantity: string; lineCount: number }> };
  }
  const lines: z.infer<typeof lineSchema>[] = [];
  const labels: Array<string | null> = [];
  const prints: Array<{ name: string; quantity: string; lineCount: number }> = [];
  for (const print of input.prints) {
    if (toQty(print.quantity) <= 0n) {
      throw new AppError("invalid_quantity", "La cantidad de piezas debe ser mayor a cero.");
    }
    const chunk = [...print.filaments, ...print.services];
    if (!chunk.length) {
      throw new AppError("empty_lines", `La impresión ${print.name} necesita al menos un servicio o un filamento.`);
    }
    const pieces = toQty(print.quantity);
    lines.push(...chunk.map((line) => ({ ...line, quantity: fromQty(mulQty(toQty(line.quantity), pieces)) })));
    labels.push(...chunk.map(() => print.name));
    prints.push({ name: print.name, quantity: print.quantity, lineCount: chunk.length });
  }
  return { lines, labels, prints };
}

function assertQuoteMode(mode: "prints" | "products", kinds: string[]) {
  if (mode === "products" && kinds.some((kind) => kind !== "product")) {
    throw new AppError(
      "quote_mode",
      "Una cotización de productos solo lleva productos. El filamento y los servicios van dentro de una impresión.",
      409,
    );
  }
  if (mode === "prints" && kinds.some((kind) => kind === "product")) {
    throw new AppError("quote_mode", "Una impresión lleva filamentos y servicios, no productos de catálogo.", 409);
  }
}

function movementDelta(kind: "receipt" | "issue" | "adjustment", quantity: string): bigint {
  const qty = toQty(quantity);
  if (kind === "adjustment") {
    if (qty === 0n) throw new AppError("invalid_quantity", "El ajuste no puede ser cero.");
    return qty;
  }
  if (qty <= 0n) throw new AppError("invalid_quantity", "La cantidad debe ser mayor a cero.");
  return kind === "issue" ? -qty : qty;
}

function cleanAddress(input: z.infer<typeof addressSchema>) {
  return {
    line1: input.line1,
    neighborhood: input.neighborhood,
    postalCode: assertPostalCode(input.postalCode),
    state: assertMxState(input.state),
    countryCode: "MX",
  };
}

function money(value: bigint | number | string, role: TenantRole): string | null {
  if (!canReadSalePrice(role)) return null;
  return Money.fromMinor(BigInt(value)).toMajor();
}

function mapCustomer(row: CustomerRow, role: TenantRole) {
  return {
    id: row.id,
    kind: row.kind,
    legalName: row.legalName,
    rfc: row.rfc,
    phone: row.phone,
    paymentTerms: row.paymentTerms,
    creditLimit: money(row.creditLimitMinor, role),
    taxRegime: row.taxRegime ?? null,
    cfdiUse: row.cfdiUse ?? "G03",
    billingEmail: row.billingEmail ?? null,
    status: row.status,
  };
}

function mapQuote(row: QuoteRow, role: TenantRole) {
  return {
    id: row.id,
    folio: row.folio,
    customerId: row.customerId,
    customerName: row.customerName,
    customerRfc: row.customerRfc,
    status: row.status,
    validUntil: row.validUntil,
    subtotal: money(row.subtotalMinor, role),
    discount: money(row.discountMinor, role),
    vat: money(row.vatMinor, role),
    total: money(row.totalMinor, role),
    serviceTerms: row.serviceTerms,
    mode: row.mode === "prints" ? "prints" as const : "products" as const,
    currency: "MXN",
    createdAt: row.createdAt,
  };
}

function mapLine(line: StoredLine, role: TenantRole) {
  return {
    id: line.id,
    printId: line.printId,
    productId: line.productId,
    serviceId: line.serviceId,
    lineKind: line.lineKind,
    terms: line.terms,
    description: line.description,
    uom: line.uom,
    quantity: fromQty(qtyFromDb(line.quantity)),
    unitPrice: money(line.unitPriceMinor, role),
    discount: money(line.discountMinor, role),
    net: money(line.netMinor, role),
    vat: money(line.vatMinor, role),
    total: money(line.totalMinor, role),
  };
}

interface BalanceRow {
  id: string;
  productId: string;
  sku: string;
  name: string;
  stockUom: string;
  locationId: string;
  locationName: string;
  onHand: string;
  allocated: string;
  reorderPoint: string;
  leadTimeDays: number;
}

interface CustomerRow {
  id: string;
  kind: string;
  legalName: string;
  rfc: string | null;
  phone: string | null;
  paymentTerms: string;
  creditLimitMinor: bigint;
  taxRegime?: string | null;
  cfdiUse?: string | null;
  billingEmail?: string | null;
  status: string;
}

interface QuoteRow {
  id: string;
  folio: string;
  customerId: string;
  customerName: string;
  customerRfc: string | null;
  status: string;
  validUntil: Date;
  subtotalMinor: bigint;
  discountMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  serviceTerms: string | null;
  mode: string;
  createdAt: Date;
}

interface StoredLine {
  id?: string;
  printId: string | null;
  productId: string | null;
  serviceId: string | null;
  lineKind: string;
  terms: string | null;
  description: string;
  uom: string;
  quantity: string;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
}
