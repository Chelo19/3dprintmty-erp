import { Controller, Get } from "@nestjs/common";
import { countsAsIncoming, isOpenProductionOrder, Money, qtyFromDb, type ProductionOrderState, type PurchaseOrderState } from "@3dprintmty/domain";
import { amountDue } from "@3dprintmty/payments";
import { count, gte } from "drizzle-orm";
import { services } from "../container";
import {
  commercialDocuments,
  companyProfiles,
  locations,
  mrpPlannedOrders,
  payments,
  productionOrders,
  productsVisible,
  purchaseOrders,
  salesOrders,
  spools,
  stockBalances,
  tenantMemberships,
} from "../db/schema";
import { CurrentUser, requireTenant, type Actor } from "../http/actor";

/** Un rollo con menos de esta fracción restante se reporta como por acabarse. */
const LOW_SPOOL_PERCENT = 20n;
const OPEN_ORDER_STATES = ["pending", "confirmed", "in_production", "ready_to_ship", "on_hold"];

@Controller("dashboard")
export class DashboardController {
  private get database() {
    return services().database;
  }

  @Get()
  async summary(@CurrentUser() actor: Actor) {
    const tenant = requireTenant(actor);
    const [company] = await this.database.asUser(tenant, (db) => db.select().from(companyProfiles).limit(1));
    const [productCount] = await this.database.asUser(tenant, (db) =>
      db.select({ value: count() }).from(productsVisible),
    );
    const [locationCount] = await this.database.asUser(tenant, (db) =>
      db.select({ value: count() }).from(locations),
    );
    const [memberCount] = await this.database.asUser(tenant, (db) =>
      db.select({ value: count() }).from(tenantMemberships),
    );
    const [orderCount] = await this.database.asUser(tenant, (db) =>
      db.select({ value: count() }).from(salesOrders),
    );
    const openOrders = await this.database.asUser(tenant, (db) => db.select().from(salesOrders));
    const ledger = await this.database.asUser(tenant, (db) => db.select().from(payments));
    const receivables = openOrders.reduce((sum: bigint, order: { id: string; status: string; totalMinor: bigint; paymentStatus: string }) => {
      if (order.status === "cancelled" || order.paymentStatus === "paid") return sum;
      const due = amountDue(
        Money.fromMinor(BigInt(order.totalMinor)),
        ledger
          .filter((entry: { salesOrderId: string }) => entry.salesOrderId === order.id)
          .map((entry: { status: string; kind: string; amountMinor: bigint }) => ({
            status: entry.status as "completed",
            kind: entry.kind as "payment",
            amount: Money.fromMinor(BigInt(entry.amountMinor)),
          })),
      ).minor;
      return sum + (due > 0n ? due : 0n);
    }, 0n);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const operations = await this.database.asUser(tenant, async (db) => {
      const production = await db
        .select({ status: productionOrders.status, dueDate: productionOrders.dueDate })
        .from(productionOrders);
      const purchases = await db.select({ status: purchaseOrders.status }).from(purchaseOrders);
      const rolls = await db
        .select({ status: spools.status, initialGrams: spools.initialGrams, currentGrams: spools.currentGrams })
        .from(spools);
      const balances = await db
        .select({ onHand: stockBalances.onHand, reorderPoint: stockBalances.reorderPoint })
        .from(stockBalances);
      const planned = await db.select({ status: mrpPlannedOrders.status }).from(mrpPlannedOrders);
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(6, 0, 0, 0);
      const documents =
        tenant.role === "production"
          ? []
          : await db
              .select({ status: commercialDocuments.status })
              .from(commercialDocuments)
              .where(gte(commercialDocuments.issuedAt, monthStart));
      const orders = openOrders as Array<{ status: string; promisedDate: string | null; shippedAt: Date | null }>;
      return {
        ordersPending: orders.filter((row) => row.status === "pending").length,
        ordersInProduction: orders.filter((row) => row.status === "in_production").length,
        ordersReadyToShip: orders.filter((row) => row.status === "ready_to_ship").length,
        ordersLate: orders.filter(
          (row) => row.promisedDate !== null && row.promisedDate < today && OPEN_ORDER_STATES.includes(row.status),
        ).length,
        shippedThisMonth: orders.filter((row) => row.shippedAt !== null && new Date(row.shippedAt) >= monthStart).length,
        productionLate: production.filter(
          (row: { status: string; dueDate: string | null }) =>
            row.dueDate !== null && row.dueDate < today && isOpenProductionOrder(row.status as ProductionOrderState),
        ).length,
        productionOpen: production.filter((row: { status: string }) => isOpenProductionOrder(row.status as ProductionOrderState)).length,
        qcHold: production.filter((row: { status: string }) => row.status === "qc_hold").length,
        purchasesIncoming: purchases.filter((row: { status: string }) => countsAsIncoming(row.status as PurchaseOrderState)).length,
        spoolsActive: rolls.filter((row: { status: string }) => row.status === "available" || row.status === "in_use").length,
        spoolsLow: rolls.filter((row: { status: string; initialGrams: string; currentGrams: string }) => {
          if (row.status !== "available" && row.status !== "in_use") return false;
          const initial = qtyFromDb(row.initialGrams);
          return initial > 0n && qtyFromDb(row.currentGrams) * 100n < initial * LOW_SPOOL_PERCENT;
        }).length,
        lowStock: balances.filter((row: { onHand: string; reorderPoint: string }) => {
          const reorder = qtyFromDb(row.reorderPoint);
          return reorder > 0n && qtyFromDb(row.onHand) <= reorder;
        }).length,
        mrpPlanned: planned.filter((row: { status: string }) => row.status === "planned" || row.status === "firmed").length,
        prefacturasThisMonth: documents.filter((row: { status: string }) => row.status === "issued").length,
      };
    });
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
      counts: {
        products: Number(productCount?.value ?? 0),
        locations: Number(locationCount?.value ?? 0),
        members: Number(memberCount?.value ?? 0),
        orders: Number(orderCount?.value ?? 0),
        productionOrders: operations.productionOpen,
        receivables: Money.fromMinor(receivables).toMajor(),
      },
      operations,
      currency: "MXN",
    };
  }
}
