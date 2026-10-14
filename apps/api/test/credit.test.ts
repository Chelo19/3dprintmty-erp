import "reflect-metadata";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../src/db/database.service";
import { auditEvents, customers, payments, salesOrders, tenantMemberships, tenants, userAccounts } from "../src/db/schema";
import { assertCredit } from "../src/modules/orders.shared";
import type { TenantActor } from "../src/http/actor";

const database = new DatabaseService({ dataDir: null });
const actor: TenantActor = { userId: crypto.randomUUID(), tenantId: crypto.randomUUID(), role: "owner", email: "owner@credit.test", platformAdmin: false, impersonator: null };
beforeAll(async () => {
  await database.onModuleInit();
  await database.asAdmin(async (db) => {
    await db.insert(userAccounts).values({ id: actor.userId, email: actor.email });
    await db.insert(tenants).values({ id: actor.tenantId, slug: "credit-test", rfc: "CRE010101AAA", status: "active" });
    await db.insert(tenantMemberships).values({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, email: actor.email });
  });
});
afterAll(async () => { await database.onModuleDestroy(); });
async function fixture(paymentTerms = "net_30") {
  return database.asUser(actor, async (db) => {
    const [customer] = await db.insert(customers).values({ tenantId: actor.tenantId, kind: "b2b", legalName: "Credit customer", paymentTerms, creditLimitMinor: 100000n, createdBy: actor.userId }).returning();
    async function order(total: bigint, status: string) {
      const [row] = await db.insert(salesOrders).values({ tenantId: actor.tenantId, customerId: customer.id, customerName: customer.legalName, folio: crypto.randomUUID(), totalMinor: total, subtotalMinor: total, vatMinor: 0n, status, createdBy: actor.userId }).returning();
      return row as typeof salesOrders.$inferSelect;
    }
    return { customer, previous: await order(100000n, "confirmed"), current: await order(80000n, "pending") };
  });
}
async function entry(orderId: string, amountMinor: bigint, status = "completed", kind = "payment") {
  await database.asUser(actor, (db) => db.insert(payments).values({ tenantId: actor.tenantId, salesOrderId: orderId, amountMinor, method: "efectivo", status, kind, createdBy: actor.userId }));
}

it("un abono libera crédito y permite llegar al límite exacto, pero no excederlo", async () => {
  const { previous, current } = await fixture();
  await entry(previous.id, 80000n);
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, undefined))).resolves.toBeNull();
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, { ...current, totalMinor: 80001n }, undefined))).rejects.toMatchObject({ code: "credit_limit" });
});
it("pendientes, fallidos y anulados no liberan crédito", async () => {
  const { previous, current } = await fixture();
  for (const status of ["pending", "failed", "voided"]) await entry(previous.id, 80000n, status);
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, undefined))).rejects.toMatchObject({ code: "credit_limit" });
});
it("los reembolsos completados vuelven a consumir crédito, aunque el estado diga paid", async () => {
  const { previous, current } = await fixture();
  await entry(previous.id, 100000n);
  await database.asUser(actor, (db) => db.update(salesOrders).set({ paymentStatus: "paid" }).where(eq(salesOrders.id, previous.id)));
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, undefined))).resolves.toBeNull();
  await entry(previous.id, 30000n, "completed", "refund");
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, undefined))).rejects.toMatchObject({ code: "credit_limit" });
});
it("al editar un pedido se descuenta también su propio anticipo", async () => {
  const { previous, current } = await fixture();
  await entry(previous.id, 100000n);
  await entry(current.id, 80000n);
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, { ...current, totalMinor: 180000n }, undefined))).resolves.toBeNull();
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, { ...current, totalMinor: 180001n }, undefined))).rejects.toMatchObject({ code: "credit_limit" });
});
it("excluye cancelados y borradores; una excepción requiere rol autorizado y queda auditada", async () => {
  const { previous, current } = await fixture();
  for (const status of ["cancelled", "draft"]) {
    await database.asUser(actor, (db) => db.update(salesOrders).set({ status }).where(eq(salesOrders.id, previous.id)));
    await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, undefined))).resolves.toBeNull();
  }
  await database.asUser(actor, (db) => db.update(salesOrders).set({ status: "confirmed" }).where(eq(salesOrders.id, previous.id)));
  const sales = { ...actor, role: "sales" as const };
  await expect(database.asUser(sales, (db) => assertCredit(db, sales, current, "Autorizado"))).rejects.toMatchObject({ code: "credit_limit" });
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, "Excepción autorizada"))).resolves.toBe("Excepción autorizada");
  const history = await database.asUser(actor, (db) => db.select().from(auditEvents).where(eq(auditEvents.entityId, current.id)));
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ action: "credit.override", actorUserId: actor.userId, metadata: { reason: "Excepción autorizada" } });
});
it("mantiene la excepción de clientes de contado", async () => {
  const { current } = await fixture("pue");
  await expect(database.asUser(actor, (db) => assertCredit(db, actor, current, undefined))).resolves.toBeNull();
});
