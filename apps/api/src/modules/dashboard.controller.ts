import { Controller, Get } from "@nestjs/common";
import {
  canReadSalePrice,
  countsAsIncoming,
  isOpenProductionOrder,
  Money,
  qtyFromDb,
  type ProductionOrderState,
  type PurchaseOrderState,
} from "@3dprintmty/domain";
import { amountDue } from "@3dprintmty/payments";
import { services } from "../container";
import {
  commercialDocuments,
  companyProfiles,
  expensePayments,
  expenses,
  payments,
  productionOrders,
  purchaseOrders,
  quotes,
  salesOrders,
  stockBalances,
} from "../db/schema";
import { CurrentUser, requireTenant, type Actor } from "../http/actor";

const OPEN_ORDER_STATES = ["pending", "confirmed", "in_production", "ready_to_ship", "on_hold"];
const OPEN_QUOTE_STATES = ["draft", "sent", "accepted"];
const PIPELINE = ["pending", "confirmed", "in_production", "ready_to_ship", "on_hold"] as const;

type OrderRow = {
  id: string;
  status: string;
  paymentStatus: string;
  totalMinor: bigint;
  promisedDate: string | null;
  shippedAt: Date | null;
};

type LedgerRow = {
  salesOrderId: string;
  status: string;
  kind: string;
  amountMinor: bigint;
  createdAt: Date;
};

type QuoteRow = { status: string; totalMinor: bigint };
type ExpenseRow = { id: string; amountMinor: bigint; occurredOn: string };
type ExpensePaymentRow = { expenseId: string; amountMinor: bigint };
type ProductionRow = { status: string; dueDate: string | null };
type PurchaseRow = { status: string };
type BalanceRow = { onHand: string; reorderPoint: string };
type DocumentRow = { status: string; totalMinor: bigint; issuedAt: Date };

@Controller("dashboard")
export class DashboardController {
  private get database() {
    return services().database;
  }

  @Get()
  async summary(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const seeMoney = canReadSalePrice(tenant.role);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const monthKeys = recentMonths(today, 6);
    const thisMonth = monthKeys[monthKeys.length - 1] ?? today.slice(0, 7);

    const [company] = await this.database.asUser(tenant, (db) => db.select().from(companyProfiles).limit(1));
    const orders = await this.database.asUser(tenant, (db) =>
      db
        .select({
          id: salesOrders.id,
          status: salesOrders.status,
          paymentStatus: salesOrders.paymentStatus,
          totalMinor: salesOrders.totalMinor,
          promisedDate: salesOrders.promisedDate,
          shippedAt: salesOrders.shippedAt,
        })
        .from(salesOrders),
    ) as OrderRow[];
    const ledger: LedgerRow[] = await this.database.asUser(tenant, (db) =>
      db
        .select({
          salesOrderId: payments.salesOrderId,
          status: payments.status,
          kind: payments.kind,
          amountMinor: payments.amountMinor,
          createdAt: payments.createdAt,
        })
        .from(payments),
    );
    const quoteRows: QuoteRow[] = await this.database.asUser(tenant, (db) =>
      db.select({ status: quotes.status, totalMinor: quotes.totalMinor }).from(quotes),
    );
    const expenseRows: ExpenseRow[] = await this.database.asUser(tenant, (db) =>
      db.select({ id: expenses.id, amountMinor: expenses.amountMinor, occurredOn: expenses.occurredOn }).from(expenses),
    );
    const expensePaid: ExpensePaymentRow[] = await this.database.asUser(tenant, (db) =>
      db.select({ expenseId: expensePayments.expenseId, amountMinor: expensePayments.amountMinor }).from(expensePayments),
    );
    const production: ProductionRow[] = await this.database.asUser(tenant, (db) =>
      db.select({ status: productionOrders.status, dueDate: productionOrders.dueDate }).from(productionOrders),
    );
    const purchases: PurchaseRow[] = await this.database.asUser(tenant, (db) =>
      db.select({ status: purchaseOrders.status }).from(purchaseOrders),
    );
    const balances: BalanceRow[] = await this.database.asUser(tenant, (db) =>
      db.select({ onHand: stockBalances.onHand, reorderPoint: stockBalances.reorderPoint }).from(stockBalances),
    );
    const documents: DocumentRow[] =
      tenant.role === "production"
        ? []
        : await this.database.asUser(tenant, (db) =>
            db
              .select({
                status: commercialDocuments.status,
                totalMinor: commercialDocuments.totalMinor,
                issuedAt: commercialDocuments.issuedAt,
              })
              .from(commercialDocuments),
          );

    const receivables = orders.reduce((sum, order) => {
      if (order.status === "cancelled" || order.paymentStatus === "paid") return sum;
      const due = amountDue(
        Money.fromMinor(order.totalMinor),
        ledger
          .filter((entry) => entry.salesOrderId === order.id)
          .map((entry) => ({
            status: entry.status as "completed",
            kind: entry.kind as "payment",
            amount: Money.fromMinor(entry.amountMinor),
          })),
      ).minor;
      return sum + (due > 0n ? due : 0n);
    }, 0n);

    const paidByExpense = new Map<string, bigint>();
    for (const payment of expensePaid) {
      paidByExpense.set(payment.expenseId, (paidByExpense.get(payment.expenseId) ?? 0n) + payment.amountMinor);
    }
    const payables = expenseRows.reduce((sum, expense) => {
      const balance = expense.amountMinor - (paidByExpense.get(expense.id) ?? 0n);
      return sum + (balance > 0n ? balance : 0n);
    }, 0n);

    const collectedByMonth = new Map<string, bigint>();
    for (const entry of ledger) {
      if (entry.status !== "completed") continue;
      const signed = entry.kind === "refund" ? -entry.amountMinor : entry.amountMinor;
      add(collectedByMonth, monthOf(entry.createdAt), signed);
    }
    const expensesByMonth = new Map<string, bigint>();
    for (const expense of expenseRows) {
      add(expensesByMonth, String(expense.occurredOn).slice(0, 7), expense.amountMinor);
    }

    const openQuotes = quoteRows.filter((row) => OPEN_QUOTE_STATES.includes(row.status));
    const openOrders = orders.filter((row) => OPEN_ORDER_STATES.includes(row.status));
    const monthStart = monthStartUtc(thisMonth);
    const operations = {
      ordersPending: orders.filter((row) => row.status === "pending").length,
      ordersInProduction: orders.filter((row) => row.status === "in_production").length,
      ordersReadyToShip: orders.filter((row) => row.status === "ready_to_ship").length,
      ordersLate: openOrders.filter((row) => row.promisedDate !== null && row.promisedDate < today).length,
      shippedThisMonth: orders.filter((row) => row.shippedAt !== null && row.shippedAt >= monthStart).length,
      productionLate: production.filter(
        (row) => row.dueDate !== null && row.dueDate < today && isOpenProductionOrder(row.status as ProductionOrderState),
      ).length,
      productionOpen: production.filter((row) => isOpenProductionOrder(row.status as ProductionOrderState)).length,
      qcHold: production.filter((row) => row.status === "qc_hold").length,
      purchasesIncoming: purchases.filter((row) => countsAsIncoming(row.status as PurchaseOrderState)).length,
      lowStock: balances.filter((row) => {
        const reorder = qtyFromDb(row.reorderPoint);
        return reorder > 0n && qtyFromDb(row.onHand) <= reorder;
      }).length,
      prefacturasThisMonth: documents.filter(
        (row) => row.status === "issued" && monthOf(row.issuedAt) === thisMonth,
      ).length,
    };

    const major = (minor: bigint) => (seeMoney ? Money.fromMinor(minor).toMajor() : null);
    return {
      company: company
        ? {
            legalName: company.legalName,
            tradeName: company.tradeName,
            rfc: company.rfc,
            vatRate: company.defaultVatRate,
            currency: company.currency,
            timezone: company.timezone,
            locale: company.locale,
            qcGate: company.qcGate,
          }
        : null,
      currency: "MXN",
      seeMoney,
      kpis: {
        collectedThisMonth: major(collectedByMonth.get(thisMonth) ?? 0n),
        collectedLastMonth: major(collectedByMonth.get(monthKeys[monthKeys.length - 2] ?? "") ?? 0n),
        expensesThisMonth: major(expensesByMonth.get(thisMonth) ?? 0n),
        expensesLastMonth: major(expensesByMonth.get(monthKeys[monthKeys.length - 2] ?? "") ?? 0n),
        receivables: major(receivables),
        payables: major(payables),
        openQuotes: openQuotes.length,
        openQuotesValue: major(openQuotes.reduce((sum, row) => sum + row.totalMinor, 0n)),
        openOrders: openOrders.length,
        openOrdersValue: major(openOrders.reduce((sum, row) => sum + row.totalMinor, 0n)),
      },
      months: monthKeys.map((key) => ({
        key,
        collected: major(collectedByMonth.get(key) ?? 0n),
        expenses: major(expensesByMonth.get(key) ?? 0n),
      })),
      pipeline: PIPELINE.map((status) => ({
        status,
        count: orders.filter((row) => row.status === status).length,
      })),
      operations,
    };
  }
}

function add(target: Map<string, bigint>, key: string, amount: bigint) {
  target.set(key, (target.get(key) ?? 0n) + amount);
}

function monthOf(value: Date) {
  return value.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 7);
}

function recentMonths(today: string, count: number) {
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthStartUtc(key: string) {
  const [yearText, monthText] = key.split("-");
  const start = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1, 6, 0, 0));
  return start;
}
