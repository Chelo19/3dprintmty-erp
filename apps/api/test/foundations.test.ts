import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/main";
import { services } from "../src/container";
import { applyMigrations, verifyMigrations } from "../src/db/migrations";
import { repoRoot } from "../src/db/database.service";
import { requireTenant, type TenantActor } from "../src/http/actor";
import { AppError } from "@3dprintmty/shared";
import { allocateFolio, audit, postStock, withIdempotency } from "../src/modules/support";
import { auditEvents, customers, idempotencyRequests, locations, numberSequences, payments, products, salesOrders, stockBalances, stockLedgers } from "../src/db/schema";

const postgresUrl = process.env.TEST_DATABASE_URL;
for (const driver of ["pglite", "postgres"] as const) {
  describe.skipIf(driver === "postgres" && !postgresUrl)(`cimientos SaaS — ${driver}`, () => {
    let app: INestApplication;
    let actor: TenantActor;
    let foreign: TenantActor;
    let token: string;
    let locationId: string;
    let testDatabaseName: string | undefined;

    beforeAll(async () => {
      if (driver === "postgres") {
        const url = new URL(postgresUrl!);
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("TEST_DATABASE_URL debe apuntar a PostgreSQL local desechable.");
        const pg = await import("pg");
        testDatabaseName = `erp_foundations_${crypto.randomUUID().replaceAll("-", "")}`;
        const admin = new pg.default.Client({ connectionString: postgresUrl });
        await admin.connect();
        try { await admin.query(`create database "${testDatabaseName}"`); } finally { await admin.end(); }
        url.pathname = `/${testDatabaseName}`;
        const client = new pg.default.Client({ connectionString: url.toString() });
        await client.connect();
        try { await applyMigrations(client, repoRoot(), true); } finally { await client.end(); }
        process.env.DATABASE_URL = url.toString();
      } else delete process.env.DATABASE_URL;
      app = await createApp({ dataDir: null });
      const first = await workshop("FSA010101AAA");
      token = first.token;
      actor = first.actor;
      foreign = (await workshop("FSB010101BBB")).actor;
      const [location] = await services().database.asUser(actor, (db) => db.select().from(locations));
      locationId = location.id;
    });
    afterAll(async () => {
      await app?.close();
      delete process.env.DATABASE_URL;
      if (testDatabaseName) {
        const pg = await import("pg");
        const admin = new pg.default.Client({ connectionString: postgresUrl });
        await admin.connect();
        try {
          // El backend puede terminar después del cierre local del socket.
          // Esperar su salida evita forzar la desconexión de clientes.
          for (let attempt = 0; ; attempt++) {
            try { await admin.query(`drop database "${testDatabaseName}"`); break; }
            catch (error) {
              if ((error as { code?: string }).code !== "55006" || attempt >= 10) throw error;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        } finally { await admin.end(); }
      }
    });

    async function workshop(rfc: string) {
      const registered = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: `${driver}-${rfc}@foundation.test`, password: "test-foundation-123" });
      expect(registered.status).toBe(201);
      const onboarded = await request(app.getHttpServer()).post("/api/v1/onboarding").set("Authorization", `Bearer ${registered.body.token}`).send({
        legalName: "Foundation", rfc, taxRegime: "626", fiscalPostalCode: "64000", state: "Nuevo León", locationName: "Matriz", locationPostalCode: "64000", vatRate: "0.16",
        paymentMethods: { efectivo: true, spei: true, tarjeta: false, mercadopago: false, conekta: false, stripe: false, cod: true, credito: false }, seedDemo: false, privacyAccepted: true,
      });
      expect(onboarded.status).toBe(201);
      return { token: onboarded.body.token as string, actor: requireTenant(await services().auth.verify(onboarded.body.token)) };
    }
    async function product(who = actor) {
      const [row] = await services().database.asUser(who, (db) => db.insert(products).values({ tenantId: who.tenantId, sku: crypto.randomUUID(), name: "Foundation product", productType: "resale", costMinor: 100n, salePriceMinor: 10000n, createdBy: who.userId }).returning());
      return row as typeof products.$inferSelect;
    }
    async function order() {
      return services().database.asUser(actor, async (db) => {
        const [customer] = await db.insert(customers).values({ tenantId: actor.tenantId, kind: "b2c", legalName: "Foundation customer", createdBy: actor.userId }).returning();
        const [row] = await db.insert(salesOrders).values({ tenantId: actor.tenantId, folio: crypto.randomUUID(), customerId: customer.id, customerName: customer.legalName, status: "confirmed", subtotalMinor: 10000n, vatMinor: 0n, totalMinor: 10000n, createdBy: actor.userId }).returning();
        return row as typeof salesOrders.$inferSelect;
      });
    }
    const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
    const post = (path: string, body: unknown, key?: string) => {
      const call = request(app.getHttpServer()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
      return (key ? call.set("Idempotency-Key", key) : call).send(body as object);
    };

    it("authenticated no puede consultar tablas, vistas, costos ni ejecutar como erp_api", async () => {
      await product();
      for (const table of ["products", "products_visible", "payments", "production_orders"]) {
        await expect(services().database.orm.transaction(async (tx: any) => {
          await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.userId, role: "authenticated" })}, true)`);
          await tx.execute(sql.raw("set local role authenticated"));
          await tx.execute(sql.raw(`select * from public.${table}`));
        })).rejects.toThrow();
      }
      const membership = await services().database.orm.transaction(async (tx: any) => {
        await tx.execute(sql.raw("set local role authenticated"));
        return tx.execute(sql.raw("select pg_has_role('authenticated','erp_api','MEMBER') as allowed"));
      });
      expect(membership.rows[0].allowed).toBe(false);
      expect((await get("/products")).status).toBe(200);
    });

    it("el helper de futuras tablas mantiene cerrada la Data API", async () => {
      const table = `foundation_${crypto.randomUUID().replaceAll("-", "")}`;
      await services().database.asAdmin((db) => db.execute(sql.raw(`create table public.${table}(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id))`)));
      await services().database.asAdmin((db) => db.execute(sql`select public.apply_tenant_rls(${table}, array['owner'])`));
      const access = await services().database.asAdmin((db) => db.execute(sql`select has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as allowed`));
      expect(access.rows[0].allowed).toBe(false);
      await services().database.asUser(actor, (db) => db.execute(sql`insert into ${sql.identifier(table)}(tenant_id) values(${actor.tenantId})`));
      const own = await services().database.asUser(actor, (db) => db.execute(sql`select * from ${sql.identifier(table)}`));
      const other = await services().database.asUser(foreign, (db) => db.execute(sql`select * from ${sql.identifier(table)}`));
      expect(own.rows).toHaveLength(1);
      expect(other.rows).toHaveLength(0);
    });

    it("rechaza una FK cruzada incluso desde la conexión administrativa", async () => {
      const otherProduct = await product(foreign);
      await expect(services().database.asAdmin((db) => db.insert(stockBalances).values({ tenantId: actor.tenantId, productId: otherProduct.id, locationId, onHand: "1", createdBy: actor.userId }))).rejects.toThrow();
    });

    it("el mismo intento concurrente registra un cobro y conserva su respuesta", async () => {
      const current = await order();
      const payload = { orderId: current.id, method: "efectivo", amount: "25.00" };
      const key = crypto.randomUUID();
      const responses = await Promise.all([post("/payments", payload, key), post("/payments", payload, key)]);
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(responses[0]!.body.id).toBe(responses[1]!.body.id);
      const ledger = await services().database.asUser(actor, (db) => db.select().from(payments).where(eq(payments.salesOrderId, current.id)));
      expect(ledger).toHaveLength(1);
      expect((await post("/payments", { ...payload, amount: "30.00" }, key)).status).toBe(409);
    });

    it("dos cobros distintos simultáneos no exceden el saldo", async () => {
      const current = await order();
      const responses = await Promise.all([post("/payments", { orderId: current.id, method: "efectivo", amount: "100.00" }, crypto.randomUUID()), post("/payments", { orderId: current.id, method: "spei", amount: "100.00" }, crypto.randomUUID())]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect((await get(`/orders/${current.id}`)).body.amountDue).toBe("0.00");
    });

    it("dos salidas simultáneas conservan saldo y kardex consistentes", async () => {
      const item = await product();
      await services().database.asUser(actor, (db) => postStock(db, actor, { productId: item.id, locationId, kind: "receipt", delta: 100000n, reason: "Initial stock" }));
      const issue = () => services().database.asUser(actor, (db) => postStock(db, actor, { productId: item.id, locationId, kind: "issue", delta: -60000n, reason: "Concurrent issue", allowNegative: false }));
      const results = await Promise.allSettled([issue(), issue()]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const [balance] = await services().database.asUser(actor, (db) => db.select().from(stockBalances).where(eq(stockBalances.productId, item.id)));
      expect(Number(balance.onHand)).toBe(4);
      const ledger = await services().database.asUser(actor, (db) => db.select().from(stockLedgers).where(eq(stockLedgers.productId, item.id)));
      expect(ledger.reduce((sum: number, entry: typeof stockLedgers.$inferSelect) => sum + Number(entry.quantity), 0)).toBe(4);
    });

    it("dos recepciones simultáneas no reciben por encima de la OC", async () => {
      const item = await product();
      const vendor = await post("/vendors", { name: `Vendor ${crypto.randomUUID()}` });
      expect(vendor.status).toBe(201);
      const purchase = await post("/purchase-orders", { vendorId: vendor.body.id, locationId, lines: [{ productId: item.id, quantity: "10", unitCost: "1.00" }] });
      expect(purchase.status).toBe(201);
      expect((await post(`/purchase-orders/${purchase.body.id}/transition`, { to: "ordered" })).status).toBe(201);
      const payload = { lines: [{ lineId: purchase.body.lines[0].id, quantity: "6" }] };
      const receipts = await Promise.all([post(`/purchase-orders/${purchase.body.id}/receive`, payload, crypto.randomUUID()), post(`/purchase-orders/${purchase.body.id}/receive`, payload, crypto.randomUUID())]);
      expect(receipts.map((response) => response.status).sort()).toEqual([201, 409]);
      const received = await get(`/purchase-orders/${purchase.body.id}`);
      expect(Number(received.body.lines[0].receivedQty)).toBe(6);
      const [balance] = await services().database.asUser(actor, (db) => db.select().from(stockBalances).where(eq(stockBalances.productId, item.id)));
      expect(Number(balance.onHand)).toBe(6);
    });

    it("revierte llave, auditoría y folio cuando la operación falla", async () => {
      const key = crypto.randomUUID();
      const effect = () => withIdempotency(services().database, actor, key, { route: "test.rollback" }, async () => {
        await allocateFolio(services().database, actor.tenantId, "test_rollback", key);
        await services().database.asUser(actor, (db) => audit(db, actor, "test.rollback", "test", null, { key }));
        throw new AppError("test_failure", "Failure after writing");
      });
      await expect(effect()).rejects.toThrow("Failure after writing");
      expect(await services().database.asAdmin((db) => db.select().from(idempotencyRequests).where(eq(idempotencyRequests.key, key)))).toHaveLength(0);
      expect(await services().database.asAdmin((db) => db.select().from(numberSequences).where(eq(numberSequences.series, key)))).toHaveLength(0);
      const history = await services().database.asUser(actor, (db) => db.select().from(auditEvents).where(and(eq(auditEvents.action, "test.rollback"), eq(auditEvents.tenantId, actor.tenantId))));
      expect(history).toHaveLength(0);
      const replay = await withIdempotency(services().database, actor, key, { route: "test.rollback" }, async () => ({ recovered: true }));
      expect(replay).toEqual({ recovered: true });
    });

    it("el hash es estable y las llaves están separadas por operación y taller", async () => {
      const key = crypto.randomUUID();
      const first = await withIdempotency(services().database, actor, key, { route: "test.hash", a: 1, b: 2 }, async () => ({ value: "first" }));
      const replay = await withIdempotency(services().database, actor, key, { b: 2, a: 1, route: "test.hash" }, async () => ({ value: "duplicate" }));
      expect(replay).toEqual(first);
      expect(await withIdempotency(services().database, actor, key, { route: "test.another" }, async () => ({ value: "another" }))).toEqual({ value: "another" });
      expect(await withIdempotency(services().database, foreign, key, { route: "test.hash", a: 1, b: 2 }, async () => ({ value: "foreign" }))).toEqual({ value: "foreign" });
    });

    it("exige llave en los procesos críticos", async () => {
      const current = await order();
      const payment = await post("/payments", { orderId: current.id, method: "efectivo", amount: "10.00" });
      expect(payment.status).toBe(400);
      expect(payment.body.code).toBe("idempotency_key_required");
      expect((await post("/prefacturas", { salesOrderId: current.id })).status).toBe(400);
      expect((await post(`/purchase-orders/${current.id}/receive`, { lines: [{ lineId: current.id, quantity: "1" }] })).status).toBe(400);
    });

    it("COD no puede exceder ni comprometer dos veces el mismo saldo", async () => {
      const current = await order();
      expect((await post("/payments", { orderId: current.id, method: "cod", amount: "200.00" }, crypto.randomUUID())).status).toBe(409);
      const cod = await post("/payments", { orderId: current.id, method: "cod", amount: "100.00" }, crypto.randomUUID());
      expect(cod.status).toBe(201);
      expect((await post("/payments", { orderId: current.id, method: "cod", amount: "1.00" }, crypto.randomUUID())).status).toBe(409);
      expect((await post("/payments", { orderId: current.id, method: "spei", amount: "50.00" }, crypto.randomUUID())).status).toBe(201);
      expect((await post(`/payments/${cod.body.id}/complete`, {})).status).toBe(409);
      expect((await post(`/payments/${cod.body.id}/void`, { reason: "Importe reemplazado tras SPEI" })).status).toBe(201);
      const corrected = await post("/payments", { orderId: current.id, method: "cod", amount: "50.00" }, crypto.randomUUID());
      expect((await post(`/payments/${corrected.body.id}/complete`, {})).status).toBe(201);
      expect((await get(`/orders/${current.id}`)).body.amountDue).toBe("0.00");
      expect((await post(`/payments/${corrected.body.id}/void`, { reason: "No debe editar dinero" })).status).toBe(409);
    });

    it("no eleva privilegios ni cambia de taller dentro de una transacción", async () => {
      await expect(services().database.asUser(actor, () => services().database.asAdmin(() => true))).rejects.toThrow("elevar privilegios");
      await expect(services().database.asUser(actor, () => services().database.asUser(foreign, () => true))).rejects.toThrow("cambiar actor");
      expect((await get("/products")).status).toBe(200);
    });

    it("el arranque rechaza migraciones faltantes y checksums modificados sin ejecutar DDL", async () => {
      const statements: string[] = [];
      await expect(verifyMigrations({ async query(text) { statements.push(text); return { rows: [] }; } }, repoRoot())).rejects.toThrow("Migración pendiente");
      expect(statements.every((statement) => statement.startsWith("select"))).toBe(true);
      await expect(verifyMigrations({ async query() { return { rows: [{ id: "0001_phase0_tenancy", checksum: "changed" }] }; } }, repoRoot())).rejects.toThrow("cambió");
    });
  });
}
