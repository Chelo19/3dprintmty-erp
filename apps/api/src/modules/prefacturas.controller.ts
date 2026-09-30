import { Body, Controller, Get, Headers, Param, Post, Query, StreamableFile } from "@nestjs/common";
import { canIssuePrefactura, formatQty, isValidRfc, Money, qtyFromDb, type SalesOrderState } from "@3dprintmty/domain";
import { mxCountryPolicy, PREFACTURA_TITLE, type CommercialDraft } from "@3dprintmty/fiscal";
import { amountDue, resolveSatPaymentTiming, type LedgerEntry } from "@3dprintmty/payments";
import { AppError } from "@3dprintmty/shared";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { services } from "../container";
import {
  auditEvents,
  commercialDocumentLines,
  commercialDocuments,
  companyProfiles,
  customerAddresses,
  customers,
  payments,
  salesOrderLines,
  salesOrders,
} from "../db/schema";
import { assertRole, CurrentUser, type Actor, type TenantActor } from "../http/actor";
import { effectiveLineDiscount, effectiveQty, type OrderLineRow } from "./orders.shared";
import { allocateFolio, audit, minorToMajor, one, withIdempotency, type Db } from "./support";
import { createZip } from "./zip";

const READERS = ["owner", "admin", "sales", "viewer", "warehouse"] as const;
const ISSUERS = ["owner", "admin", "sales"] as const;
const EXPORTERS = ["owner", "admin", "viewer"] as const;

const NOT_CFDI_NOTICE =
  "Prefacturas / Notas de venta — no son CFDI. Sirven para que tu contador timbre las facturas en su sistema.";

const SAT_FORM_BY_METHOD: Record<string, string> = { efectivo: "01", spei: "03", tarjeta: "04" };

const issueSchema = z.object({ salesOrderId: z.string().uuid() });
const voidSchema = z.object({ reason: z.string().trim().min(3).max(200) });
const exportSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(["json", "csv", "zip"]).default("json"),
});

@Controller()
export class PrefacturasController {
  private get database() {
    return services().database;
  }

  @Get("prefacturas")
  async list(@CurrentUser() actor: Actor) {
    const tenant = assertRole(actor, [...READERS]);
    const rows = await this.database.asUser(tenant, (db) =>
      db.select().from(commercialDocuments).orderBy(desc(commercialDocuments.issuedAt)),
    );
    return { data: rows.map(mapDocument) };
  }

  @Get("prefacturas/:id")
  async get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    const tenant = assertRole(actor, [...READERS]);
    return this.database.asUser(tenant, (db) => loadDocument(db, id));
  }

  @Post("prefacturas")
  async issue(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenant = assertRole(actor, [...ISSUERS]);
    const input = issueSchema.parse(body);
    return withIdempotency(this.database, tenant.userId, idempotencyKey, { route: "prefacturas", input }, () =>
      this.doIssue(tenant, input.salesOrderId),
    );
  }

  private async doIssue(tenant: TenantActor, salesOrderId: string) {
    const draft = await this.database.asUser(tenant, (db) => buildPrefactura(db, salesOrderId));
    const folio = await allocateFolio(this.database, tenant.tenantId, "prefactura", draft.company.preinvoiceSeries);
    return this.database.asUser(tenant, async (db) => {
      const { order, company, lines, issued, warnings, intendedPayment, satPaymentForm } = await buildPrefactura(db, salesOrderId);
      const [document] = await db
        .insert(commercialDocuments)
        .values({
          tenantId: tenant.tenantId,
          kind: "prefactura",
          salesOrderId: order.id,
          series: company.preinvoiceSeries,
          folio,
          status: "issued",
          title: PREFACTURA_TITLE,
          emitter: issued.emitter,
          receiver: issued.receiver,
          intendedPayment,
          satPaymentForm,
          subtotalMinor: BigInt(order.subtotalMinor),
          discountMinor: BigInt(order.discountMinor),
          shippingMinor: BigInt(order.shippingMinor),
          vatMinor: BigInt(order.vatMinor),
          totalMinor: BigInt(order.totalMinor),
          incomplete: warnings.length > 0,
          warnings,
          createdBy: tenant.userId,
        })
        .returning();
      await db.insert(commercialDocumentLines).values(
        lines.map((line: SalesLineRow) => ({
          tenantId: tenant.tenantId,
          documentId: document.id,
          description: line.description,
          quantity: String(line.quantity),
          unitPriceMinor: BigInt(line.unitPriceMinor),
          discountMinor: BigInt(line.discountMinor),
          netMinor: BigInt(line.netMinor),
          vatMinor: BigInt(line.vatMinor),
          totalMinor: BigInt(line.totalMinor),
        })),
      );
      await audit(db, tenant, "prefactura.issued", "commercial_document", document.id, {
        series: document.series,
        folio: document.folio,
        order: order.folio,
      });
      return loadDocument(db, document.id);
    });
  }

  @Post("prefacturas/:id/void")
  async void(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    const tenant = assertRole(actor, ["owner", "admin"]);
    const input = voidSchema.parse(body);
    return this.database.asUser(tenant, async (db) => {
      const document = await one(db, commercialDocuments, commercialDocuments.id, id, "No encontramos esa prefactura.");
      if (document.status === "void") throw new AppError("already_void", "Esa prefactura ya está cancelada.", 409);
      await db
        .update(commercialDocuments)
        .set({ status: "void", voidReason: input.reason, voidedAt: new Date(), voidedBy: tenant.userId, updatedAt: new Date() })
        .where(eq(commercialDocuments.id, document.id));
      await audit(db, tenant, "prefactura.voided", "commercial_document", document.id, { reason: input.reason });
      return loadDocument(db, document.id);
    });
  }

  @Get("exports/accountant")
  async exportPackage(
    @CurrentUser() actor: Actor,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("format") format?: string,
  ) {
    const tenant = assertRole(actor, [...EXPORTERS]);
    const input = exportSchema.parse({ from, to, format: format ?? undefined });
    if (input.from > input.to) throw new AppError("invalid_period", "La fecha inicial es posterior a la final.");
    const start = new Date(`${input.from}T00:00:00-06:00`);
    const end = new Date(new Date(`${input.to}T00:00:00-06:00`).getTime() + 24 * 60 * 60 * 1000);
    const data = await this.database.asUser(tenant, async (db) => {
      const [company] = await db.select().from(companyProfiles).limit(1);
      const documents = await db
        .select()
        .from(commercialDocuments)
        .where(and(gte(commercialDocuments.issuedAt, start), lt(commercialDocuments.issuedAt, end)))
        .orderBy(commercialDocuments.series, commercialDocuments.folio);
      const received = await db
        .select({ payment: payments, folio: salesOrders.folio })
        .from(payments)
        .innerJoin(salesOrders, eq(salesOrders.id, payments.salesOrderId))
        .where(and(gte(payments.createdAt, start), lt(payments.createdAt, end)))
        .orderBy(payments.createdAt);
      await audit(db, tenant, "accountant_package.exported", "export", null, {
        from: input.from,
        to: input.to,
        format: input.format,
        documents: documents.length,
      });
      return { company, documents, received };
    });

    const documents = data.documents.map((row: DocumentRow) => ({
      ...mapDocument(row),
      receiver: row.receiver,
    }));
    const paymentRows = data.received.map(({ payment, folio }: { payment: PaymentRow; folio: string }) => ({
      date: payment.createdAt,
      order: folio,
      method: payment.method,
      satPaymentForm: SAT_FORM_BY_METHOD[payment.method] ?? "99",
      kind: payment.kind,
      status: payment.status,
      amount: minorToMajor(payment.amountMinor),
      reference: payment.reference,
    }));
    const issued = data.documents.filter((row: DocumentRow) => row.status === "issued");
    const totals = {
      documents: data.documents.length,
      issued: issued.length,
      void: data.documents.length - issued.length,
      subtotal: minorToMajor(issued.reduce((sum: bigint, row: DocumentRow) => sum + BigInt(row.subtotalMinor), 0n)),
      vat: minorToMajor(issued.reduce((sum: bigint, row: DocumentRow) => sum + BigInt(row.vatMinor), 0n)),
      total: minorToMajor(issued.reduce((sum: bigint, row: DocumentRow) => sum + BigInt(row.totalMinor), 0n)),
    };
    const pack = {
      version: "accountant_package_v1" as const,
      countryCode: "MX" as const,
      notice: NOT_CFDI_NOTICE,
      emitter: data.company
        ? { legalName: data.company.legalName, rfc: data.company.rfc, taxRegime: data.company.taxRegime }
        : null,
      period: { from: input.from, to: input.to, timezone: "America/Mexico_City" },
      totals,
      documents,
      payments: paymentRows,
    };
    if (input.format === "json") return pack;

    const documentsCsv = toCsv(
      [
        "serie", "folio", "fecha", "estado", "receptor_rfc", "receptor_nombre", "uso_cfdi", "metodo_pago",
        "forma_pago", "subtotal", "descuento", "envio", "iva", "total", "moneda", "incompleta", "motivo_cancelacion",
      ],
      data.documents.map((row: DocumentRow) => {
        const receiver = row.receiver as { rfc?: string; legalName?: string; cfdiUse?: string };
        return [
          row.series, String(row.folio), row.issuedAt.toISOString(), row.status === "issued" ? "vigente" : "cancelada",
          receiver.rfc ?? "", receiver.legalName ?? "", receiver.cfdiUse ?? "", row.intendedPayment, row.satPaymentForm,
          minorToMajor(row.subtotalMinor), minorToMajor(row.discountMinor), minorToMajor(row.shippingMinor),
          minorToMajor(row.vatMinor), minorToMajor(row.totalMinor), row.currency, row.incomplete ? "si" : "no",
          row.voidReason ?? "",
        ];
      }),
    );
    const stamp = `${input.from}_${input.to}`;
    if (input.format === "csv") {
      return new StreamableFile(Buffer.from(documentsCsv, "utf8"), {
        type: "text/csv; charset=utf-8",
        disposition: `attachment; filename="prefacturas_${stamp}.csv"`,
      });
    }
    const paymentsCsv = toCsv(
      ["fecha", "pedido", "metodo", "forma_pago_sat", "tipo", "estado", "importe", "referencia"],
      paymentRows.map((row: { date: Date; order: string; method: string; satPaymentForm: string; kind: string; status: string; amount: string; reference: string | null }) => [
        row.date.toISOString(), row.order, row.method, row.satPaymentForm, row.kind, row.status, row.amount, row.reference ?? "",
      ]),
    );
    const readme = [
      "Paquete para el contador",
      "",
      NOT_CFDI_NOTICE,
      "",
      `Periodo: ${input.from} a ${input.to} (hora del centro de México).`,
      "prefacturas.csv: una fila por prefactura, incluidas las canceladas.",
      "cobros.csv: cobros y reembolsos registrados en el periodo.",
      "paquete.json: la misma información en formato accountant_package_v1.",
    ].join("\r\n");
    const zip = createZip([
      { name: "prefacturas.csv", data: documentsCsv },
      { name: "cobros.csv", data: paymentsCsv },
      { name: "paquete.json", data: JSON.stringify(pack, null, 2) },
      { name: "LEEME.txt", data: readme },
    ]);
    return new StreamableFile(zip, {
      type: "application/zip",
      disposition: `attachment; filename="paquete_contador_${stamp}.zip"`,
    });
  }
}

/**
 * Arma y valida la prefactura sin escribir. Se corre antes de asignar el folio
 * para que un error de datos no deje huecos en la serie.
 */
async function buildPrefactura(db: Db, salesOrderId: string) {
  const order = await one(db, salesOrders, salesOrders.id, salesOrderId, "No encontramos ese pedido.");
  if (!canIssuePrefactura(order.status as SalesOrderState)) {
    throw new AppError("order_not_billable", "Confirma el pedido antes de emitir la prefactura.", 409);
  }
  const [active] = await db
    .select({ id: commercialDocuments.id })
    .from(commercialDocuments)
    .where(and(eq(commercialDocuments.salesOrderId, order.id), eq(commercialDocuments.status, "issued")))
    .limit(1);
  if (active) {
    throw new AppError("prefactura_exists", "Ese pedido ya tiene una prefactura vigente. Cancélala para emitir otra.", 409);
  }
  const [company] = await db.select().from(companyProfiles).limit(1);
  if (!company) throw new AppError("company_required", "Completa los datos de la empresa.", 409);
  const customer = await one(db, customers, customers.id, order.customerId, "No encontramos al cliente.");
  const [fiscal] = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customer.id), eq(customerAddresses.kind, "fiscal")))
    .limit(1);
  const rows: OrderLineRow[] = await db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, order.id))
    .orderBy(asc(salesOrderLines.position), asc(salesOrderLines.createdAt));
  const lines = rows
    .filter((line) => effectiveQty(line) > 0n)
    .map((line) => ({
      ...line,
      quantity: formatQty(effectiveQty(line)),
      discountMinor: effectiveLineDiscount(line),
    }));
  const ledger: PaymentRow[] = await db.select().from(payments).where(eq(payments.salesOrderId, order.id));

  const intendedPayment: "PUE" | "PPD" = (order.paymentTerms ?? customer.paymentTerms) === "pue" ? "PUE" : "PPD";
  const completed = ledger.filter((row) => row.status === "completed" && row.kind === "payment");
  const methods = [...new Set(completed.map((row) => row.method))];
  const satPaymentForm =
    intendedPayment === "PUE" && methods.length === 1 ? SAT_FORM_BY_METHOD[methods[0] as string] ?? "99" : "99";

  const rfc = customer.rfc ?? "";
  const commercial: CommercialDraft = {
    emitter: {
      legalName: company.legalName,
      rfc: company.rfc,
      taxRegime: company.taxRegime,
      postalCode: company.fiscalPostalCode,
    },
    receiver: {
      legalName: customer.legalName,
      rfc,
      taxRegime: customer.taxRegime ?? undefined,
      postalCode: fiscal?.postalCode ?? company.fiscalPostalCode,
      cfdiUse: customer.cfdiUse ?? "G03",
      kind: !isValidRfc(rfc) ? "publico_general" : rfc.length === 12 ? "persona_moral" : "persona_fisica",
    },
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: Money.fromMinor(BigInt(line.unitPriceMinor)).toMajor(),
      discount: Money.fromMinor(BigInt(line.discountMinor)).toMajor(),
      taxable: true,
    })),
    taxRate: String(company.defaultVatRate),
    intendedPayment,
    satPaymentForm,
    series: company.preinvoiceSeries,
  };
  const issued = mxCountryPolicy.invoiceEngine.issue(commercial);
  const warnings = [...issued.warnings];
  if (!issued.incomplete && !customer.taxRegime) {
    warnings.push({ code: "receiver_regime_missing", message: "Falta el régimen fiscal del cliente." });
  }
  if (!fiscal) {
    warnings.push({ code: "receiver_address_missing", message: "El cliente no tiene domicilio fiscal; se usó el CP del taller." });
  }
  return { order, company, lines, issued, warnings, intendedPayment, satPaymentForm };
}

async function loadDocument(db: Db, id: string) {
  const document = await one(db, commercialDocuments, commercialDocuments.id, id, "No encontramos esa prefactura.");
  const lines = await db.select().from(commercialDocumentLines).where(eq(commercialDocumentLines.documentId, document.id));
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, document.salesOrderId)).limit(1);
  const ledger = await db.select().from(payments).where(eq(payments.salesOrderId, document.salesOrderId));
  const entries: LedgerEntry[] = ledger.map((row: PaymentRow) => ({
    status: row.status as LedgerEntry["status"],
    kind: row.kind as LedgerEntry["kind"],
    amount: Money.fromMinor(BigInt(row.amountMinor)),
  }));
  const total = Money.fromMinor(BigInt(document.totalMinor));
  const history = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "commercial_document"), eq(auditEvents.entityId, document.id)))
    .orderBy(desc(auditEvents.createdAt));
  return {
    ...mapDocument(document),
    emitter: document.emitter,
    receiver: document.receiver,
    notice: NOT_CFDI_NOTICE,
    orderFolio: order?.folio ?? null,
    amountDue: amountDue(total, entries).toMajor(),
    satPaymentTiming: resolveSatPaymentTiming(document.intendedPayment as "PUE" | "PPD", total, entries),
    lines: lines.map((line: DocumentLineRow) => ({
      id: line.id,
      description: line.description,
      quantity: formatQty(qtyFromDb(line.quantity)),
      unitPrice: minorToMajor(line.unitPriceMinor),
      discount: minorToMajor(line.discountMinor),
      net: minorToMajor(line.netMinor),
      vat: minorToMajor(line.vatMinor),
      total: minorToMajor(line.totalMinor),
    })),
    payments: ledger.map((row: PaymentRow) => ({
      id: row.id,
      method: row.method,
      kind: row.kind,
      status: row.status,
      amount: minorToMajor(row.amountMinor),
      reference: row.reference,
      createdAt: row.createdAt,
    })),
    history: history.map((event: { action: string; createdAt: Date; metadata: unknown }) => ({
      action: event.action,
      createdAt: event.createdAt,
      metadata: event.metadata,
    })),
  };
}

function mapDocument(row: DocumentRow) {
  const receiver = row.receiver as { legalName?: string; rfc?: string };
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    series: row.series,
    folio: row.folio,
    number: `${row.series}-${row.folio}`,
    status: row.status,
    salesOrderId: row.salesOrderId,
    receiverName: receiver.legalName ?? "",
    receiverRfc: receiver.rfc ?? "",
    intendedPayment: row.intendedPayment,
    satPaymentForm: row.satPaymentForm,
    subtotal: minorToMajor(row.subtotalMinor),
    discount: minorToMajor(row.discountMinor),
    shipping: minorToMajor(row.shippingMinor),
    vat: minorToMajor(row.vatMinor),
    total: minorToMajor(row.totalMinor),
    currency: row.currency,
    incomplete: row.incomplete,
    warnings: row.warnings,
    issuedAt: row.issuedAt,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt,
  };
}

function toCsv(header: string[], rows: string[][]): string {
  const escape = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `\uFEFF${[header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}

interface DocumentRow {
  id: string;
  kind: string;
  title: string;
  series: string;
  folio: number;
  status: string;
  salesOrderId: string;
  emitter: unknown;
  receiver: unknown;
  intendedPayment: string;
  satPaymentForm: string;
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  incomplete: boolean;
  warnings: unknown;
  issuedAt: Date;
  voidReason: string | null;
  voidedAt: Date | null;
}

interface DocumentLineRow {
  id: string;
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
}

interface SalesLineRow {
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
}

interface PaymentRow {
  id: string;
  method: string;
  kind: string;
  status: string;
  amountMinor: bigint;
  reference: string | null;
  createdAt: Date;
}
